import io
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.modules.identity.models import (
    AuditEvent,
    Department,
    Organization,
    PortalNotification,
    User,
)
from app.modules.identity.routes import get_current_user
from app.modules.identity.service import role_keys_for_user
from app.modules.marketing_leads.excel import build_merchandising_sample_requests_workbook
from app.modules.marketing_leads.models import (
    MarketingLead,
    MarketingLeadActivity,
    MarketingSampleBatch,
    MarketingSampleItem,
)
from app.modules.marketing_leads.pdf import build_marketing_employee_report
from app.modules.marketing_leads.schemas import (
    CreateMarketingSampleRequest,
    CreateMarketingLeadRequest,
    LeadDecisionRequest,
    LeadReplyRequest,
    LeadStatus,
    MarketingBreakdownRow,
    MarketingAnalysisEmployee,
    MarketingAnalysisFeedItem,
    MarketingAnalysisSummary,
    MarketingLeadActivityResponse,
    MarketingLeadListResponse,
    MarketingLeadResponse,
    MarketingLiveAnalysis,
    MarketingMonthlyReport,
    MarketingReportRow,
    MarketingSampleItemResponse,
    MarketingSampleListResponse,
    MarketingSampleResponse,
    SampleStatus,
    UpdateMarketingSampleRequest,
)

router = APIRouter()
TOP_ADMIN_ROLES = {"owner", "super_admin"}
SUPER_ADMIN_ROLE = "owner"
MARKETING_SLUG = "marketing"
MERCHANDISING_SLUG = "merchandising"
OPEN_FOR_MERCHANDISING = {"submitted", "resubmitted"}
SAMPLE_STATUSES = (
    "recorded", "dispatched", "awaiting_feedback", "satisfied",
    "not_satisfied", "order_received", "closed",
)


def _lead_access_scope(roles: set[str], department_slug: str | None) -> str:
    if roles.intersection(TOP_ADMIN_ROLES) or "department_admin" in roles:
        return "department"
    if department_slug == MARKETING_SLUG:
        return "own"
    return "active_queue"


def _can_view_marketing_report(roles: set[str], department_slug: str | None) -> bool:
    return bool(
        roles.intersection(TOP_ADMIN_ROLES)
        or (department_slug == MARKETING_SLUG and "department_admin" in roles)
    )


def _can_delete_marketing_lead(
    roles: set[str],
    department_slug: str | None,
    *,
    creator_user_id: UUID | None,
    current_user_id: UUID,
) -> bool:
    is_marketing_user = department_slug == MARKETING_SLUG
    is_top_admin = bool(roles.intersection(TOP_ADMIN_ROLES))
    return (is_marketing_user or is_top_admin) and creator_user_id == current_user_id


def _apply_lead_scope(query, *, scope: str, user: User):
    if scope == "own":
        return query.where(MarketingLead.created_by_user_id == user.id)
    if scope == "active_queue":
        questioned_lead_ids = select(MarketingLeadActivity.lead_id).where(
            MarketingLeadActivity.actor_user_id == user.id,
            MarketingLeadActivity.action == "questioned",
        )
        return query.where(or_(
            MarketingLead.status.in_(OPEN_FOR_MERCHANDISING),
            MarketingLead.decided_by_user_id == user.id,
            MarketingLead.id.in_(questioned_lead_ids),
        ))
    return query


async def _access_context(session: AsyncSession, user: User) -> tuple[set[str], str | None]:
    roles = set(await role_keys_for_user(session, user.id))
    department = await session.get(Department, user.department_id) if user.department_id else None
    department_slug = department.slug if department else None
    if not roles.intersection(TOP_ADMIN_ROLES) and department_slug not in {
        MARKETING_SLUG, MERCHANDISING_SLUG
    }:
        raise HTTPException(
            status_code=403,
            detail="This workflow is available only to Marketing, Merchandising and the Super Admin.",
        )
    return roles, department_slug


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


async def _marketing_sample_access(
    session: AsyncSession, user: User
) -> tuple[set[str], str | None]:
    roles, department_slug = await _access_context(session, user)
    if department_slug != MARKETING_SLUG and not roles.intersection(TOP_ADMIN_ROLES):
        raise HTTPException(
            status_code=403,
            detail="The customer sample register is available only to Marketing and the Super Admin.",
        )
    return roles, department_slug


async def _department_users(
    session: AsyncSession, organization_id: UUID, department_slug: str
) -> list[User]:
    return list(await session.scalars(
        select(User)
        .join(Department, Department.id == User.department_id)
        .where(
            User.organization_id == organization_id,
            User.status == "active",
            Department.slug == department_slug,
        )
    ))


def _add_notifications(
    session: AsyncSession,
    *,
    recipients: list[User],
    lead: MarketingLead,
    kind: str,
    title: str,
    message: str,
    severity: str = "info",
) -> None:
    event_key = uuid4()
    for recipient in recipients:
        session.add(PortalNotification(
            organization_id=lead.organization_id,
            user_id=recipient.id,
            kind=kind,
            title=title,
            message=message,
            severity=severity,
            href="/department-tools/marketing-leads",
            dedupe_key=f"marketing-lead:{lead.id}:{event_key}:{recipient.id}",
        ))


async def _create_sample_batch(
    session: AsyncSession,
    *,
    user: User,
    payload,
    company_name: str,
    linked_lead_id: UUID | None = None,
    status: str | None = None,
) -> MarketingSampleBatch:
    batch = MarketingSampleBatch(
        organization_id=user.organization_id,
        created_by_user_id=user.id,
        linked_lead_id=linked_lead_id,
        serial_number=_clean(payload.serial_number),
        sample_date=payload.sample_date,
        company_name=company_name.strip(),
        remark=_clean(payload.remark),
        status=status or getattr(payload, "status", "awaiting_feedback"),
    )
    session.add(batch)
    await session.flush()
    for position, item in enumerate(payload.items):
        session.add(MarketingSampleItem(
            organization_id=user.organization_id,
            batch_id=batch.id,
            fragrance_name=item.fragrance_name.strip(),
            fragrance_code=_clean(item.fragrance_code),
            application=_clean(item.application),
            quantity=_clean(item.quantity),
            cost=_clean(item.cost),
            position=position,
        ))
    await session.flush()
    return batch


async def _serialize_samples(
    session: AsyncSession, batches: list[MarketingSampleBatch]
) -> list[MarketingSampleResponse]:
    if not batches:
        return []
    batch_ids = [batch.id for batch in batches]
    items = list(await session.scalars(
        select(MarketingSampleItem)
        .where(MarketingSampleItem.batch_id.in_(batch_ids))
        .order_by(MarketingSampleItem.position.asc(), MarketingSampleItem.fragrance_name.asc())
    ))
    creator_ids = {batch.created_by_user_id for batch in batches if batch.created_by_user_id}
    creators = (
        list(await session.scalars(select(User).where(User.id.in_(creator_ids))))
        if creator_ids else []
    )
    creator_map = {creator.id: creator for creator in creators}
    item_map: dict[UUID, list[MarketingSampleItemResponse]] = defaultdict(list)
    for item in items:
        item_map[item.batch_id].append(MarketingSampleItemResponse(
            id=str(item.id),
            fragrance_name=item.fragrance_name,
            fragrance_code=item.fragrance_code,
            application=item.application,
            quantity=item.quantity,
            cost=item.cost,
            position=item.position,
        ))
    return [MarketingSampleResponse(
        id=str(batch.id),
        linked_lead_id=str(batch.linked_lead_id) if batch.linked_lead_id else None,
        serial_number=batch.serial_number,
        sample_date=batch.sample_date,
        company_name=batch.company_name,
        remark=batch.remark,
        status=batch.status,
        created_by_user_id=str(batch.created_by_user_id) if batch.created_by_user_id else None,
        created_by_name=(
            creator_map[batch.created_by_user_id].full_name
            if batch.created_by_user_id in creator_map else "Former user"
        ),
        created_at=batch.created_at,
        updated_at=batch.updated_at,
        items=item_map[batch.id],
    ) for batch in batches]


async def _serialize_leads(
    session: AsyncSession, leads: list[MarketingLead]
) -> list[MarketingLeadResponse]:
    if not leads:
        return []
    lead_ids = [lead.id for lead in leads]
    activities = list(await session.scalars(
        select(MarketingLeadActivity)
        .where(MarketingLeadActivity.lead_id.in_(lead_ids))
        .order_by(MarketingLeadActivity.created_at.asc())
    ))
    sample_batches = list(await session.scalars(
        select(MarketingSampleBatch)
        .where(MarketingSampleBatch.linked_lead_id.in_(lead_ids))
        .order_by(MarketingSampleBatch.sample_date.desc(), MarketingSampleBatch.created_at.desc())
    ))
    serialized_samples = await _serialize_samples(session, sample_batches)
    sample_map: dict[UUID, list[MarketingSampleResponse]] = defaultdict(list)
    for sample in serialized_samples:
        if sample.linked_lead_id:
            sample_map[UUID(sample.linked_lead_id)].append(sample)
    user_ids = {
        user_id
        for lead in leads
        for user_id in (lead.created_by_user_id, lead.decided_by_user_id)
        if user_id
    }
    user_ids.update(activity.actor_user_id for activity in activities if activity.actor_user_id)
    users = list(await session.scalars(select(User).where(User.id.in_(user_ids)))) if user_ids else []
    user_map = {user.id: user for user in users}
    department_ids = {user.department_id for user in users if user.department_id}
    departments = (
        list(await session.scalars(select(Department).where(Department.id.in_(department_ids))))
        if department_ids else []
    )
    department_map = {department.id: department.name for department in departments}
    activity_map: dict[UUID, list[MarketingLeadActivityResponse]] = defaultdict(list)
    for activity in activities:
        actor = user_map.get(activity.actor_user_id)
        activity_map[activity.lead_id].append(MarketingLeadActivityResponse(
            id=str(activity.id),
            action=activity.action,
            message=activity.message,
            actor_name=actor.full_name if actor else "Former user",
            actor_department=department_map.get(actor.department_id) if actor else None,
            created_at=activity.created_at,
        ))

    result: list[MarketingLeadResponse] = []
    for lead in leads:
        creator = user_map.get(lead.created_by_user_id)
        decider = user_map.get(lead.decided_by_user_id)
        result.append(MarketingLeadResponse(
            id=str(lead.id),
            company_name=lead.company_name,
            contact_person=lead.contact_person,
            phone_number=lead.phone_number,
            email=lead.email,
            country=lead.country,
            region=lead.region,
            product_interest=lead.product_interest,
            expected_quantity=lead.expected_quantity,
            lead_source=lead.lead_source,
            priority=lead.priority,
            requirement=lead.requirement,
            notes=lead.notes,
            status=lead.status,
            created_by_user_id=str(lead.created_by_user_id) if lead.created_by_user_id else None,
            created_by_name=creator.full_name if creator else "Former user",
            decision_reason=lead.decision_reason,
            decided_by_name=decider.full_name if decider else None,
            first_merchandising_response_at=lead.first_merchandising_response_at,
            decided_at=lead.decided_at,
            submitted_at=lead.submitted_at,
            updated_at=lead.updated_at,
            activities=activity_map[lead.id],
            samples=sample_map[lead.id],
        ))
    return result


async def _lead_or_404(session: AsyncSession, user: User, lead_id: UUID) -> MarketingLead:
    lead = await session.scalar(
        select(MarketingLead)
        .where(
            MarketingLead.id == lead_id,
            MarketingLead.organization_id == user.organization_id,
        )
        .with_for_update()
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Marketing lead not found.")
    return lead


async def _sample_or_404(
    session: AsyncSession, user: User, sample_id: UUID
) -> MarketingSampleBatch:
    sample = await session.scalar(
        select(MarketingSampleBatch)
        .where(
            MarketingSampleBatch.id == sample_id,
            MarketingSampleBatch.organization_id == user.organization_id,
        )
        .with_for_update()
    )
    if not sample:
        raise HTTPException(status_code=404, detail="Customer sample record not found.")
    return sample


@router.get("", response_model=MarketingLeadListResponse)
async def list_marketing_leads(
    status: LeadStatus | None = Query(default=None),
    search: str = Query(default="", max_length=200),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingLeadListResponse:
    roles, department_slug = await _access_context(session, user)
    scope = _lead_access_scope(roles, department_slug)
    query = select(MarketingLead).where(MarketingLead.organization_id == user.organization_id)
    query = _apply_lead_scope(query, scope=scope, user=user)
    if status:
        query = query.where(MarketingLead.status == status)
    if search.strip():
        needle = f"%{search.strip()}%"
        query = query.where(or_(
            MarketingLead.company_name.ilike(needle),
            MarketingLead.contact_person.ilike(needle),
            MarketingLead.region.ilike(needle),
            MarketingLead.product_interest.ilike(needle),
        ))
    leads = list(await session.scalars(query.order_by(MarketingLead.updated_at.desc()).limit(500)))
    items = await _serialize_leads(session, leads)
    visible_query = select(MarketingLead.status).where(
        MarketingLead.organization_id == user.organization_id
    )
    visible_query = _apply_lead_scope(visible_query, scope=scope, user=user)
    counts = Counter(await session.scalars(visible_query))
    return MarketingLeadListResponse(
        items=items,
        counts={key: counts.get(key, 0) for key in (
            "submitted", "clarification_required", "resubmitted", "accepted", "rejected"
        )},
    )


@router.get("/samples", response_model=MarketingSampleListResponse)
async def list_marketing_samples(
    status: SampleStatus | None = Query(default=None),
    search: str = Query(default="", max_length=200),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingSampleListResponse:
    roles, department_slug = await _marketing_sample_access(session, user)
    query = select(MarketingSampleBatch).where(
        MarketingSampleBatch.organization_id == user.organization_id
    )
    if department_slug == MARKETING_SLUG and not roles.intersection(TOP_ADMIN_ROLES):
        if "department_admin" not in roles:
            query = query.where(MarketingSampleBatch.created_by_user_id == user.id)
    if status:
        query = query.where(MarketingSampleBatch.status == status)
    if search.strip():
        needle = f"%{search.strip()}%"
        matching_batch_ids = select(MarketingSampleItem.batch_id).where(or_(
            MarketingSampleItem.fragrance_name.ilike(needle),
            MarketingSampleItem.fragrance_code.ilike(needle),
            MarketingSampleItem.application.ilike(needle),
        ))
        query = query.where(or_(
            MarketingSampleBatch.company_name.ilike(needle),
            MarketingSampleBatch.serial_number.ilike(needle),
            MarketingSampleBatch.id.in_(matching_batch_ids),
        ))
    batches = list(await session.scalars(
        query.order_by(
            MarketingSampleBatch.sample_date.desc(), MarketingSampleBatch.updated_at.desc()
        ).limit(500)
    ))

    visible_query = select(MarketingSampleBatch.status).where(
        MarketingSampleBatch.organization_id == user.organization_id
    )
    if (
        department_slug == MARKETING_SLUG
        and not roles.intersection(TOP_ADMIN_ROLES)
        and "department_admin" not in roles
    ):
        visible_query = visible_query.where(MarketingSampleBatch.created_by_user_id == user.id)
    counts = Counter(await session.scalars(visible_query))
    return MarketingSampleListResponse(
        items=await _serialize_samples(session, batches),
        counts={key: counts.get(key, 0) for key in SAMPLE_STATUSES},
    )


@router.post("/samples", response_model=MarketingSampleResponse, status_code=201)
async def create_marketing_sample(
    payload: CreateMarketingSampleRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingSampleResponse:
    roles, _ = await _marketing_sample_access(session, user)
    if payload.linked_lead_id:
        lead = await _lead_or_404(session, user, payload.linked_lead_id)
        if (
            lead.created_by_user_id != user.id
            and "department_admin" not in roles
            and not roles.intersection(TOP_ADMIN_ROLES)
        ):
            raise HTTPException(status_code=403, detail="You can link samples only to your own leads.")
    batch = await _create_sample_batch(
        session,
        user=user,
        payload=payload,
        company_name=payload.company_name,
        linked_lead_id=payload.linked_lead_id,
    )
    session.add(AuditEvent(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="marketing_sample.created",
        target_type="marketing_sample",
        target_id=str(batch.id),
        metadata_json={"company": batch.company_name, "sample_items": len(payload.items)},
    ))
    await session.commit()
    await session.refresh(batch)
    return (await _serialize_samples(session, [batch]))[0]


@router.get("/samples/export")
async def export_merchandising_sample_requests(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    roles, department_slug = await _access_context(session, user)
    is_merchandising_admin = (
        department_slug == MERCHANDISING_SLUG and "department_admin" in roles
    )
    if not is_merchandising_admin and SUPER_ADMIN_ROLE not in roles:
        raise HTTPException(
            status_code=403,
            detail="Sample request export is available only to the Merchandising Department Admin.",
        )

    batches = list(await session.scalars(
        select(MarketingSampleBatch).where(
            MarketingSampleBatch.organization_id == user.organization_id,
            MarketingSampleBatch.linked_lead_id.is_not(None),
        ).order_by(
            MarketingSampleBatch.sample_date.desc(),
            MarketingSampleBatch.created_at.desc(),
        )
    ))
    lead_ids = {batch.linked_lead_id for batch in batches if batch.linked_lead_id}
    leads = list(await session.scalars(
        select(MarketingLead).where(
            MarketingLead.organization_id == user.organization_id,
            MarketingLead.id.in_(lead_ids),
        )
    )) if lead_ids else []
    lead_map = {lead.id: lead for lead in leads}
    batch_ids = [batch.id for batch in batches]
    items = list(await session.scalars(
        select(MarketingSampleItem)
        .where(MarketingSampleItem.batch_id.in_(batch_ids))
        .order_by(MarketingSampleItem.position.asc())
    )) if batch_ids else []
    item_map: dict[UUID, list[MarketingSampleItem]] = defaultdict(list)
    for item in items:
        item_map[item.batch_id].append(item)

    response_activities = list(await session.scalars(
        select(MarketingLeadActivity).where(
            MarketingLeadActivity.lead_id.in_(lead_ids),
            MarketingLeadActivity.action.in_(("questioned", "accepted", "rejected")),
        ).order_by(MarketingLeadActivity.created_at.desc())
    )) if lead_ids else []
    response_map: dict[UUID, MarketingLeadActivity] = {}
    for activity in response_activities:
        response_map.setdefault(activity.lead_id, activity)

    user_ids = {
        user_id
        for lead in leads
        for user_id in (lead.created_by_user_id, lead.decided_by_user_id)
        if user_id
    }
    user_ids.update(
        activity.actor_user_id for activity in response_activities if activity.actor_user_id
    )
    users = list(await session.scalars(select(User).where(User.id.in_(user_ids)))) if user_ids else []
    user_map = {person.id: person for person in users}

    rows: list[dict] = []
    for batch in batches:
        lead = lead_map.get(batch.linked_lead_id)
        if not lead:
            continue
        marketing_employee = user_map.get(lead.created_by_user_id)
        response_activity = response_map.get(lead.id)
        handler = user_map.get(
            response_activity.actor_user_id if response_activity else lead.decided_by_user_id
        )
        batch_items = item_map.get(batch.id) or [None]
        for item in batch_items:
            rows.append({
                "lead_id": str(lead.id),
                "sample_id": str(batch.id),
                "sample_reference": batch.serial_number,
                "sample_date": batch.sample_date,
                "lead_submitted_at": lead.submitted_at,
                "company_name": lead.company_name,
                "contact_person": lead.contact_person,
                "phone_number": lead.phone_number,
                "email": lead.email,
                "country": lead.country,
                "region": lead.region,
                "product_interest": lead.product_interest,
                "expected_quantity": lead.expected_quantity,
                "lead_source": lead.lead_source,
                "priority": lead.priority,
                "marketing_employee": (
                    marketing_employee.full_name if marketing_employee else "Former user"
                ),
                "lead_status": lead.status,
                "merchandising_response_at": lead.first_merchandising_response_at,
                "handled_by": handler.full_name if handler else None,
                "fragrance_name": item.fragrance_name if item else None,
                "fragrance_code": item.fragrance_code if item else None,
                "application": item.application if item else None,
                "sample_quantity": item.quantity if item else None,
                "sample_cost": item.cost if item else None,
                "sample_status": batch.status,
                "sample_remark": batch.remark,
                "requirement": lead.requirement,
                "lead_notes": lead.notes,
            })
    generated_at = datetime.now(timezone.utc)
    content = build_merchandising_sample_requests_workbook(
        rows, generated_at=generated_at
    )
    filename = f"AROMAZEN Merchandising Sample Requests {generated_at.date().isoformat()}.xlsx"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.patch("/samples/{sample_id}", response_model=MarketingSampleResponse)
async def update_marketing_sample(
    sample_id: UUID,
    payload: UpdateMarketingSampleRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingSampleResponse:
    roles, _ = await _marketing_sample_access(session, user)
    batch = await _sample_or_404(session, user, sample_id)
    if (
        batch.created_by_user_id != user.id
        and "department_admin" not in roles
        and not roles.intersection(TOP_ADMIN_ROLES)
    ):
        raise HTTPException(status_code=403, detail="You can update only your own sample records.")
    previous_status = batch.status
    batch.status = payload.status
    if payload.remark is not None:
        batch.remark = _clean(payload.remark)
    session.add(AuditEvent(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="marketing_sample.updated",
        target_type="marketing_sample",
        target_id=str(batch.id),
        metadata_json={"from_status": previous_status, "to_status": batch.status},
    ))
    await session.commit()
    await session.refresh(batch)
    return (await _serialize_samples(session, [batch]))[0]


@router.post("", response_model=MarketingLeadResponse, status_code=201)
async def create_marketing_lead(
    payload: CreateMarketingLeadRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingLeadResponse:
    roles, department_slug = await _access_context(session, user)
    if department_slug != MARKETING_SLUG and not roles.intersection(TOP_ADMIN_ROLES):
        raise HTTPException(status_code=403, detail="Only Marketing can submit a lead.")
    lead = MarketingLead(
        organization_id=user.organization_id,
        created_by_user_id=user.id,
        company_name=payload.company_name.strip(),
        contact_person=payload.contact_person.strip(),
        phone_number=_clean(payload.phone_number),
        email=str(payload.email) if payload.email else None,
        country=payload.country.strip(),
        region=payload.region.strip(),
        product_interest=payload.product_interest.strip(),
        expected_quantity=_clean(payload.expected_quantity),
        lead_source=payload.lead_source.strip(),
        priority=payload.priority,
        requirement=payload.requirement.strip(),
        notes=_clean(payload.notes),
        status="submitted",
    )
    session.add(lead)
    await session.flush()
    if payload.sample:
        await _create_sample_batch(
            session,
            user=user,
            payload=payload.sample,
            company_name=lead.company_name,
            linked_lead_id=lead.id,
            status="recorded",
        )
    session.add(MarketingLeadActivity(
        organization_id=user.organization_id,
        lead_id=lead.id,
        actor_user_id=user.id,
        action="submitted",
        message="Lead submitted to Merchandising.",
    ))
    recipients = await _department_users(session, user.organization_id, MERCHANDISING_SLUG)
    _add_notifications(
        session,
        recipients=recipients,
        lead=lead,
        kind="marketing_lead_submitted",
        title="New Marketing lead",
        message=f"{user.full_name} submitted {lead.company_name} for review.",
    )
    session.add(AuditEvent(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="marketing_lead.submitted",
        target_type="marketing_lead",
        target_id=str(lead.id),
        metadata_json={
            "company": lead.company_name,
            "region": lead.region,
            "sample_items": len(payload.sample.items) if payload.sample else 0,
        },
    ))
    await session.commit()
    await session.refresh(lead)
    return (await _serialize_leads(session, [lead]))[0]


@router.post("/{lead_id}/decision", response_model=MarketingLeadResponse)
async def decide_marketing_lead(
    lead_id: UUID,
    payload: LeadDecisionRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingLeadResponse:
    roles, department_slug = await _access_context(session, user)
    if department_slug != MERCHANDISING_SLUG and not roles.intersection(TOP_ADMIN_ROLES):
        raise HTTPException(status_code=403, detail="Only Merchandising can respond to a lead.")
    lead = await _lead_or_404(session, user, lead_id)
    if lead.status not in OPEN_FOR_MERCHANDISING:
        raise HTTPException(status_code=409, detail="This lead is not awaiting a Merchandising response.")

    now = datetime.now(timezone.utc)
    if lead.first_merchandising_response_at is None:
        lead.first_merchandising_response_at = now
    message = _clean(payload.message)
    if payload.action == "question":
        lead.status = "clarification_required"
        lead.decision_reason = None
        activity_action = "questioned"
        notification_title = "Merchandising needs clarification"
        notification_message = f"{user.full_name} asked a question about {lead.company_name}."
        severity = "warning"
    else:
        lead.status = "accepted" if payload.action == "accept" else "rejected"
        lead.decided_by_user_id = user.id
        lead.decision_reason = message
        lead.decided_at = now
        activity_action = lead.status
        notification_title = f"Lead {lead.status}"
        notification_message = f"Merchandising {lead.status} the {lead.company_name} lead."
        severity = "info" if lead.status == "accepted" else "warning"
    session.add(MarketingLeadActivity(
        organization_id=user.organization_id,
        lead_id=lead.id,
        actor_user_id=user.id,
        action=activity_action,
        message=message,
    ))
    creator = await session.get(User, lead.created_by_user_id)
    _add_notifications(
        session,
        recipients=[creator] if creator and creator.status == "active" else [],
        lead=lead,
        kind=f"marketing_lead_{activity_action}",
        title=notification_title,
        message=notification_message,
        severity=severity,
    )
    session.add(AuditEvent(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action=f"marketing_lead.{activity_action}",
        target_type="marketing_lead",
        target_id=str(lead.id),
        metadata_json={"company": lead.company_name},
    ))
    await session.commit()
    await session.refresh(lead)
    return (await _serialize_leads(session, [lead]))[0]


@router.post("/{lead_id}/reply", response_model=MarketingLeadResponse)
async def reply_to_marketing_question(
    lead_id: UUID,
    payload: LeadReplyRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingLeadResponse:
    roles, department_slug = await _access_context(session, user)
    if department_slug != MARKETING_SLUG and not roles.intersection(TOP_ADMIN_ROLES):
        raise HTTPException(status_code=403, detail="Only Marketing can answer this question.")
    lead = await _lead_or_404(session, user, lead_id)
    if lead.created_by_user_id != user.id and "department_admin" not in roles and not roles.intersection(TOP_ADMIN_ROLES):
        raise HTTPException(status_code=403, detail="You can answer questions only for your own leads.")
    if lead.status != "clarification_required":
        raise HTTPException(status_code=409, detail="This lead is not waiting for clarification.")
    lead.status = "resubmitted"
    session.add(MarketingLeadActivity(
        organization_id=user.organization_id,
        lead_id=lead.id,
        actor_user_id=user.id,
        action="clarification_replied",
        message=payload.message.strip(),
    ))
    recipients = await _department_users(session, user.organization_id, MERCHANDISING_SLUG)
    _add_notifications(
        session,
        recipients=recipients,
        lead=lead,
        kind="marketing_lead_resubmitted",
        title="Marketing answered your question",
        message=f"{user.full_name} replied about {lead.company_name}.",
    )
    session.add(AuditEvent(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="marketing_lead.clarification_replied",
        target_type="marketing_lead",
        target_id=str(lead.id),
        metadata_json={"company": lead.company_name},
    ))
    await session.commit()
    await session.refresh(lead)
    return (await _serialize_leads(session, [lead]))[0]


@router.delete("/{lead_id}", status_code=204)
async def delete_marketing_lead(
    lead_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> None:
    roles, department_slug = await _access_context(session, user)
    lead = await _lead_or_404(session, user, lead_id)
    if not _can_delete_marketing_lead(
        roles,
        department_slug,
        creator_user_id=lead.created_by_user_id,
        current_user_id=user.id,
    ):
        raise HTTPException(
            status_code=403,
            detail="You can permanently delete only the Marketing leads you created.",
        )

    sample_batch_ids = list(await session.scalars(
        select(MarketingSampleBatch.id).where(
            MarketingSampleBatch.organization_id == user.organization_id,
            MarketingSampleBatch.linked_lead_id == lead.id,
        )
    ))
    if sample_batch_ids:
        await session.execute(
            delete(MarketingSampleItem).where(
                MarketingSampleItem.organization_id == user.organization_id,
                MarketingSampleItem.batch_id.in_(sample_batch_ids),
            )
        )
        await session.execute(
            delete(MarketingSampleBatch).where(
                MarketingSampleBatch.organization_id == user.organization_id,
                MarketingSampleBatch.id.in_(sample_batch_ids),
            )
        )

    await session.execute(
        delete(MarketingLeadActivity).where(
            MarketingLeadActivity.organization_id == user.organization_id,
            MarketingLeadActivity.lead_id == lead.id,
        )
    )
    await session.execute(
        delete(PortalNotification).where(
            PortalNotification.organization_id == user.organization_id,
            PortalNotification.dedupe_key.like(f"marketing-lead:{lead.id}:%"),
        )
    )
    await session.execute(
        delete(AuditEvent).where(
            AuditEvent.organization_id == user.organization_id,
            AuditEvent.target_type == "marketing_lead",
            AuditEvent.target_id == str(lead.id),
        )
    )
    if sample_batch_ids:
        await session.execute(
            delete(AuditEvent).where(
                AuditEvent.organization_id == user.organization_id,
                AuditEvent.target_type == "marketing_sample",
                AuditEvent.target_id.in_([str(batch_id) for batch_id in sample_batch_ids]),
            )
        )
    session.add(AuditEvent(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="marketing_lead.deleted",
        target_type="marketing_lead",
        target_id=str(lead.id),
        metadata_json={
            "linked_sample_batches_deleted": len(sample_batch_ids),
        },
    ))
    await session.delete(lead)
    await session.commit()


def _month_bounds(month: str) -> tuple[datetime, datetime]:
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Month must use YYYY-MM format.") from error
    next_month = datetime(start.year + (start.month == 12), (start.month % 12) + 1, 1, tzinfo=timezone.utc)
    return start, next_month


def _performance_rows(leads: list[MarketingLead], labels: dict[UUID, str] | None = None, field: str = "") -> list[MarketingReportRow]:
    groups: dict[str, list[MarketingLead]] = defaultdict(list)
    for lead in leads:
        if labels is not None:
            label = labels.get(lead.created_by_user_id, "Former user") if lead.created_by_user_id else "Former user"
        else:
            label = str(getattr(lead, field) or "Not specified")
        groups[label].append(lead)
    rows: list[MarketingReportRow] = []
    for label, items in groups.items():
        counts = Counter(item.status for item in items)
        decided = counts["accepted"] + counts["rejected"]
        rows.append(MarketingReportRow(
            label=label,
            total=len(items),
            accepted=counts["accepted"],
            rejected=counts["rejected"],
            clarification_required=counts["clarification_required"],
            pending=counts["submitted"] + counts["resubmitted"],
            acceptance_rate=round(counts["accepted"] * 100 / decided, 1) if decided else 0,
        ))
    return sorted(rows, key=lambda row: (-row.total, row.label.lower()))


def _breakdown(values: list[str | None]) -> list[MarketingBreakdownRow]:
    counts = Counter(value.strip() if value and value.strip() else "Not specified" for value in values)
    return [MarketingBreakdownRow(label=label, count=count) for label, count in counts.most_common()]


def _analysis_period(days: int) -> tuple[datetime | None, str]:
    labels = {
        0: "All time",
        7: "Last 7 days",
        30: "Last 30 days",
        90: "Last 90 days",
        365: "Last 12 months",
    }
    if days not in labels:
        raise HTTPException(
            status_code=422,
            detail="Reporting range must be 0, 7, 30, 90 or 365 days.",
        )
    return (
        datetime.now(timezone.utc) - timedelta(days=days) if days else None,
        labels[days],
    )


def _rate(numerator: int, denominator: int) -> float:
    return round(numerator * 100 / denominator, 1) if denominator else 0


async def _marketing_live_analysis(
    session: AsyncSession,
    user: User,
    days: int,
) -> tuple[
    MarketingLiveAnalysis,
    list[MarketingLead],
    list[MarketingSampleBatch],
    dict[UUID, list[MarketingSampleItem]],
]:
    roles, _ = await _access_context(session, user)
    if SUPER_ADMIN_ROLE not in roles:
        raise HTTPException(
            status_code=403,
            detail="Marketing Analysis is available only to the Super Admin.",
        )

    since, period_label = _analysis_period(days)
    now = datetime.now(timezone.utc)
    local_now = now.astimezone(ZoneInfo("Asia/Kolkata"))
    today_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(
        timezone.utc
    )

    lead_query = select(MarketingLead).where(
        MarketingLead.organization_id == user.organization_id
    )
    sample_query = select(MarketingSampleBatch).where(
        MarketingSampleBatch.organization_id == user.organization_id
    )
    if since:
        lead_query = lead_query.where(MarketingLead.submitted_at >= since)
        sample_query = sample_query.where(MarketingSampleBatch.created_at >= since)
    leads = list(await session.scalars(lead_query.order_by(MarketingLead.submitted_at.desc())))
    batches = list(await session.scalars(
        sample_query.order_by(MarketingSampleBatch.updated_at.desc())
    ))

    batch_ids = [batch.id for batch in batches]
    sample_items = list(await session.scalars(
        select(MarketingSampleItem)
        .where(MarketingSampleItem.batch_id.in_(batch_ids))
        .order_by(MarketingSampleItem.position.asc())
    )) if batch_ids else []
    item_map: dict[UUID, list[MarketingSampleItem]] = defaultdict(list)
    for item in sample_items:
        item_map[item.batch_id].append(item)

    activity_query = select(MarketingLeadActivity).where(
        MarketingLeadActivity.organization_id == user.organization_id
    )
    if since:
        activity_query = activity_query.where(MarketingLeadActivity.created_at >= since)
    activities = list(await session.scalars(
        activity_query.order_by(MarketingLeadActivity.created_at.desc()).limit(250)
    ))

    lead_map = {lead.id: lead for lead in leads}
    missing_lead_ids = {activity.lead_id for activity in activities} - set(lead_map)
    if missing_lead_ids:
        activity_leads = list(await session.scalars(
            select(MarketingLead).where(
                MarketingLead.organization_id == user.organization_id,
                MarketingLead.id.in_(missing_lead_ids),
            )
        ))
        lead_map.update({lead.id: lead for lead in activity_leads})

    marketing_users = await _department_users(
        session, user.organization_id, MARKETING_SLUG
    )
    user_ids = {member.id for member in marketing_users}
    user_ids.update(lead.created_by_user_id for lead in lead_map.values() if lead.created_by_user_id)
    user_ids.update(batch.created_by_user_id for batch in batches if batch.created_by_user_id)
    user_ids.update(activity.actor_user_id for activity in activities if activity.actor_user_id)
    users = list(await session.scalars(select(User).where(User.id.in_(user_ids)))) if user_ids else []
    user_map = {member.id: member for member in users}

    lead_counts = Counter(lead.status for lead in leads)
    decided = lead_counts["accepted"] + lead_counts["rejected"]
    response_hours = [
        (lead.first_merchandising_response_at - lead.submitted_at).total_seconds() / 3600
        for lead in leads
        if lead.first_merchandising_response_at
    ]
    sample_counts = Counter(batch.status for batch in batches)
    summary = MarketingAnalysisSummary(
        total_leads=len(leads),
        pending_review=lead_counts["submitted"] + lead_counts["resubmitted"],
        clarification_required=lead_counts["clarification_required"],
        accepted=lead_counts["accepted"],
        rejected=lead_counts["rejected"],
        decision_rate=_rate(decided, len(leads)),
        acceptance_rate=_rate(lead_counts["accepted"], decided),
        average_response_hours=(
            round(sum(response_hours) / len(response_hours), 1) if response_hours else None
        ),
        total_samples=len(batches),
        sample_items=len(sample_items),
        awaiting_feedback=sample_counts["awaiting_feedback"],
        satisfied=sample_counts["satisfied"],
        orders_received=sample_counts["order_received"],
        sample_to_order_rate=_rate(sample_counts["order_received"], len(batches)),
        leads_today=sum(lead.submitted_at >= today_start for lead in leads),
        samples_today=sum(batch.created_at >= today_start for batch in batches),
    )

    employee_rows: list[MarketingAnalysisEmployee] = []
    for member in marketing_users:
        member_leads = [lead for lead in leads if lead.created_by_user_id == member.id]
        member_batches = [batch for batch in batches if batch.created_by_user_id == member.id]
        member_lead_counts = Counter(lead.status for lead in member_leads)
        member_sample_counts = Counter(batch.status for batch in member_batches)
        member_decided = member_lead_counts["accepted"] + member_lead_counts["rejected"]
        member_response_hours = [
            (lead.first_merchandising_response_at - lead.submitted_at).total_seconds() / 3600
            for lead in member_leads
            if lead.first_merchandising_response_at
        ]
        activity_times = [lead.updated_at for lead in member_leads]
        activity_times.extend(batch.updated_at for batch in member_batches)
        employee_rows.append(MarketingAnalysisEmployee(
            employee_id=str(member.id),
            employee_name=member.full_name,
            total_leads=len(member_leads),
            accepted=member_lead_counts["accepted"],
            rejected=member_lead_counts["rejected"],
            clarification_required=member_lead_counts["clarification_required"],
            pending=member_lead_counts["submitted"] + member_lead_counts["resubmitted"],
            decision_rate=_rate(member_decided, len(member_leads)),
            acceptance_rate=_rate(member_lead_counts["accepted"], member_decided),
            average_response_hours=(
                round(sum(member_response_hours) / len(member_response_hours), 1)
                if member_response_hours else None
            ),
            sample_batches=len(member_batches),
            sample_items=sum(len(item_map[batch.id]) for batch in member_batches),
            awaiting_feedback=member_sample_counts["awaiting_feedback"],
            satisfied=member_sample_counts["satisfied"],
            orders_received=member_sample_counts["order_received"],
            sample_to_order_rate=_rate(
                member_sample_counts["order_received"], len(member_batches)
            ),
            last_activity_at=max(activity_times) if activity_times else None,
        ))
    employee_rows.sort(
        key=lambda row: (-(row.total_leads + row.sample_batches), row.employee_name.lower())
    )

    feed: list[MarketingAnalysisFeedItem] = []
    for lead in leads:
        creator = user_map.get(lead.created_by_user_id)
        creator_name = creator.full_name if creator else "Former user"
        feed.append(MarketingAnalysisFeedItem(
            id=f"lead:{lead.id}:submitted",
            kind="lead",
            title="New lead sent to Merchandising",
            detail=f"{lead.company_name} • {lead.product_interest} • {lead.region}",
            status=lead.status,
            actor_name=creator_name,
            employee_name=creator_name,
            occurred_at=lead.submitted_at,
        ))

    activity_titles = {
        "questioned": "Merchandising asked for clarification",
        "clarification_replied": "Marketing sent a clarification",
        "accepted": "Lead accepted by Merchandising",
        "rejected": "Lead rejected by Merchandising",
        "resubmitted": "Lead returned to Merchandising",
    }
    for activity in activities:
        if activity.action == "submitted":
            continue
        lead = lead_map.get(activity.lead_id)
        if not lead:
            continue
        actor = user_map.get(activity.actor_user_id)
        creator = user_map.get(lead.created_by_user_id)
        feed.append(MarketingAnalysisFeedItem(
            id=f"activity:{activity.id}",
            kind="lead_activity",
            title=activity_titles.get(
                activity.action, activity.action.replace("_", " ").title()
            ),
            detail=f"{lead.company_name} • {activity.message or lead.product_interest}",
            status=activity.action,
            actor_name=actor.full_name if actor else "Former user",
            employee_name=creator.full_name if creator else "Former user",
            occurred_at=activity.created_at,
        ))

    for batch in batches:
        creator = user_map.get(batch.created_by_user_id)
        creator_name = creator.full_name if creator else "Former user"
        item_count = len(item_map[batch.id])
        feed.append(MarketingAnalysisFeedItem(
            id=f"sample:{batch.id}",
            kind="sample",
            title=(
                "Customer sample status updated"
                if batch.updated_at and batch.updated_at > batch.created_at + timedelta(seconds=1)
                else "Customer sample recorded"
            ),
            detail=(
                f"{batch.company_name} • {item_count} "
                f"fragrance{'s' if item_count != 1 else ''}"
            ),
            status=batch.status,
            actor_name=creator_name,
            employee_name=creator_name,
            occurred_at=batch.updated_at or batch.created_at,
        ))
    feed.sort(key=lambda item: item.occurred_at, reverse=True)

    analysis = MarketingLiveAnalysis(
        generated_at=now,
        range_days=days,
        period_label=period_label,
        summary=summary,
        employees=employee_rows,
        regions=_performance_rows(leads, field="region"),
        lead_sources=_breakdown([lead.lead_source for lead in leads]),
        product_interests=_breakdown([lead.product_interest for lead in leads]),
        sample_applications=_breakdown([item.application for item in sample_items]),
        recent_activity=feed[:50],
    )
    return analysis, leads, batches, item_map


@router.get("/analysis/live", response_model=MarketingLiveAnalysis)
async def live_marketing_analysis(
    days: int = Query(default=30),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingLiveAnalysis:
    analysis, _, _, _ = await _marketing_live_analysis(session, user, days)
    return analysis


@router.get("/analysis/employees/{employee_id}/pdf")
async def marketing_employee_analysis_pdf(
    employee_id: UUID,
    days: int = Query(default=30),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    analysis, leads, batches, item_map = await _marketing_live_analysis(session, user, days)
    employee = next(
        (row for row in analysis.employees if row.employee_id == str(employee_id)),
        None,
    )
    if employee is None:
        raise HTTPException(status_code=404, detail="Active Marketing employee not found.")
    employee_leads = [lead for lead in leads if lead.created_by_user_id == employee_id]
    employee_batches = [batch for batch in batches if batch.created_by_user_id == employee_id]
    organization = await session.get(Organization, user.organization_id)
    report = build_marketing_employee_report(
        organization_name=organization.name if organization else "AROMAZEN",
        employee=employee.model_dump(mode="python"),
        period_label=analysis.period_label,
        generated_at=analysis.generated_at,
        leads=[{
            "submitted_at": lead.submitted_at,
            "company_name": lead.company_name,
            "region": lead.region,
            "product_interest": lead.product_interest,
            "lead_source": lead.lead_source,
            "status": lead.status,
        } for lead in employee_leads],
        samples=[{
            "sample_date": batch.sample_date,
            "company_name": batch.company_name,
            "status": batch.status,
            "items": [{
                "fragrance_name": item.fragrance_name,
                "application": item.application,
            } for item in item_map[batch.id]],
        } for batch in employee_batches],
        logo_path=(
            Path(__file__).resolve().parents[2]
            / "assets"
            / "hr_letters"
            / "aromazen-logo.png"
        ),
    )
    safe_name = re.sub(r"[^a-zA-Z0-9]+", "-", employee.employee_name).strip("-").lower()
    filename = f"marketing-performance-{safe_name or 'employee'}.pdf"
    return StreamingResponse(
        io.BytesIO(report),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/report/monthly", response_model=MarketingMonthlyReport)
async def monthly_marketing_report(
    month: str = Query(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m")),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingMonthlyReport:
    roles, department_slug = await _access_context(session, user)
    if not _can_view_marketing_report(roles, department_slug):
        raise HTTPException(
            status_code=403,
            detail="The monthly Marketing report is visible to the Marketing Department Admin and Super Admin.",
        )
    start, end = _month_bounds(month)
    leads = list(await session.scalars(
        select(MarketingLead).where(
            MarketingLead.organization_id == user.organization_id,
            MarketingLead.submitted_at >= start,
            MarketingLead.submitted_at < end,
        )
    ))
    creator_ids = {lead.created_by_user_id for lead in leads if lead.created_by_user_id}
    creators = list(await session.scalars(select(User).where(User.id.in_(creator_ids)))) if creator_ids else []
    creator_names = {creator.id: creator.full_name for creator in creators}
    counts = Counter(lead.status for lead in leads)
    decided = counts["accepted"] + counts["rejected"]
    response_hours = [
        (lead.first_merchandising_response_at - lead.submitted_at).total_seconds() / 3600
        for lead in leads if lead.first_merchandising_response_at
    ]
    return MarketingMonthlyReport(
        month=month,
        total=len(leads),
        accepted=counts["accepted"],
        rejected=counts["rejected"],
        clarification_required=counts["clarification_required"],
        pending=counts["submitted"] + counts["resubmitted"],
        acceptance_rate=round(counts["accepted"] * 100 / decided, 1) if decided else 0,
        average_response_hours=round(sum(response_hours) / len(response_hours), 1) if response_hours else None,
        employees=_performance_rows(leads, labels=creator_names),
        regions=_performance_rows(leads, field="region"),
        lead_sources=_breakdown([lead.lead_source for lead in leads]),
        product_interests=_breakdown([lead.product_interest for lead in leads]),
        rejection_reasons=_breakdown([
            lead.decision_reason for lead in leads if lead.status == "rejected"
        ]),
    )
