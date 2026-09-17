from collections import Counter, defaultdict
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.modules.identity.models import AuditEvent, Department, PortalNotification, User
from app.modules.identity.routes import get_current_user
from app.modules.identity.service import role_keys_for_user
from app.modules.marketing_leads.models import MarketingLead, MarketingLeadActivity
from app.modules.marketing_leads.schemas import (
    CreateMarketingLeadRequest,
    LeadDecisionRequest,
    LeadReplyRequest,
    LeadStatus,
    MarketingBreakdownRow,
    MarketingLeadActivityResponse,
    MarketingLeadListResponse,
    MarketingLeadResponse,
    MarketingMonthlyReport,
    MarketingReportRow,
)

router = APIRouter()
TOP_ADMIN_ROLES = {"owner", "super_admin"}
MARKETING_SLUG = "marketing"
MERCHANDISING_SLUG = "merchandising"
OPEN_FOR_MERCHANDISING = {"submitted", "resubmitted"}


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


@router.get("", response_model=MarketingLeadListResponse)
async def list_marketing_leads(
    status: LeadStatus | None = Query(default=None),
    search: str = Query(default="", max_length=200),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingLeadListResponse:
    roles, department_slug = await _access_context(session, user)
    query = select(MarketingLead).where(MarketingLead.organization_id == user.organization_id)
    if department_slug == MARKETING_SLUG and not roles.intersection(TOP_ADMIN_ROLES):
        if "department_admin" not in roles:
            query = query.where(MarketingLead.created_by_user_id == user.id)
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
    if department_slug == MARKETING_SLUG and not roles.intersection(TOP_ADMIN_ROLES) and "department_admin" not in roles:
        visible_query = visible_query.where(MarketingLead.created_by_user_id == user.id)
    counts = Counter(await session.scalars(visible_query))
    return MarketingLeadListResponse(
        items=items,
        counts={key: counts.get(key, 0) for key in (
            "submitted", "clarification_required", "resubmitted", "accepted", "rejected"
        )},
    )


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
        metadata_json={"company": lead.company_name, "region": lead.region},
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


@router.get("/report/monthly", response_model=MarketingMonthlyReport)
async def monthly_marketing_report(
    month: str = Query(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m")),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingMonthlyReport:
    roles, _ = await _access_context(session, user)
    if "owner" not in roles:
        raise HTTPException(status_code=403, detail="The monthly Marketing report is visible only to the Super Admin.")
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
