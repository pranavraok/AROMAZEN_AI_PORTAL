from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.core.currency import usd_to_inr, usd_to_inr_rate
from app.modules.dashboard.schemas import (
    DashboardActivity,
    DashboardDepartmentUsage,
    DashboardDocument,
    DashboardMetric,
    DashboardOverview,
    HRActionCenter,
    HRActionItem,
)
from app.modules.identity.models import (
    AIUsageEvent,
    AuditEvent,
    Department,
    KnowledgeCollection,
    KnowledgeDocument,
    PayrollBatch,
    User,
    collection_departments,
)
from app.modules.identity.routes import get_current_user
from app.modules.identity.authorization import department_matches
from app.modules.identity.service import role_keys_for_user
from app.modules.assets.models import ITAsset
from app.modules.assets.routes import maintenance_status

router = APIRouter()

ROLE_ORDER = ("owner", "super_admin", "department_admin", "employee")
ROLE_PRESENTATION = {
    "owner": ("Super Admin", "platform", "All departments and platform controls"),
    "super_admin": ("Admin", "organization", "All departments in your organization"),
    "department_admin": ("Department Admin", "department", "Your department only"),
    "employee": ("Employee", "personal", "Your own activity and permitted knowledge"),
}
CAPABILITIES = {
    "owner": ["Full platform control", "Manage admins and roles", "Organization-wide analytics", "All knowledge and audit activity"],
    "super_admin": ["Manage departments and employees", "Organization-wide analytics", "Manage knowledge and organization settings", "View audit activity"],
    "department_admin": ["Manage employees in own department", "Department knowledge", "Department activity", "No role or organization settings"],
    "employee": ["Personal AI activity", "Permitted knowledge", "No administration access"],
}


def _primary_role(role_keys: set[str]) -> str:
    return next((key for key in ROLE_ORDER if key in role_keys), "employee")


def _collection_scope(user: User, scope: str):
    if scope in {"platform", "organization"}:
        return KnowledgeCollection.organization_id == user.organization_id
    department_access = select(collection_departments.c.collection_id).where(
        collection_departments.c.department_id == user.department_id
    )
    return and_(
        KnowledgeCollection.organization_id == user.organization_id,
        or_(KnowledgeCollection.is_shared.is_(True), KnowledgeCollection.id.in_(department_access)),
    )


@router.get("/overview", response_model=DashboardOverview)
async def dashboard_overview(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> DashboardOverview:
    role_key = _primary_role(await role_keys_for_user(session, user.id))
    role_label, scope, default_scope_label = ROLE_PRESENTATION[role_key]
    department = await session.get(Department, user.department_id) if user.department_id else None
    scope_label = department.name if scope == "department" and department else default_scope_label

    usage_filters = [AIUsageEvent.organization_id == user.organization_id]
    user_filters = [User.organization_id == user.organization_id]
    audit_filters = [AuditEvent.organization_id == user.organization_id]
    if scope == "department":
        usage_filters.append(AIUsageEvent.department_id == user.department_id)
        user_filters.append(User.department_id == user.department_id)
    elif scope == "personal":
        usage_filters.append(AIUsageEvent.user_id == user.id)
        user_filters.append(User.id == user.id)
        audit_filters.append(AuditEvent.actor_user_id == user.id)

    month_start = func.date_trunc("month", func.now())
    day_start = func.date_trunc("day", func.now())
    usage = (await session.execute(
        select(
            func.coalesce(func.sum(AIUsageEvent.cost_usd).filter(AIUsageEvent.created_at >= day_start), 0).label("cost_today"),
            func.count(AIUsageEvent.id).filter(and_(AIUsageEvent.created_at >= month_start, AIUsageEvent.operation == "chat")).label("requests_month"),
        ).where(*usage_filters)
    )).one()
    exchange_rate = await usd_to_inr_rate()
    active_users = await session.scalar(select(func.count(User.id)).where(*user_filters, User.status == "active")) or 0
    accessible_collection_filter = _collection_scope(user, scope)
    indexed_documents = await session.scalar(
        select(func.count(KnowledgeDocument.id))
        .join(KnowledgeCollection, KnowledgeCollection.id == KnowledgeDocument.collection_id)
        .where(accessible_collection_filter, KnowledgeDocument.status == "ready")
    ) or 0
    available_collections = await session.scalar(
        select(func.count(KnowledgeCollection.id)).where(accessible_collection_filter, KnowledgeCollection.status == "active")
    ) or 0

    metrics = [
        DashboardMetric(key="ai_cost_today", label="AI Cost Today", value=usd_to_inr(float(usage.cost_today), exchange_rate), format="currency"),
        DashboardMetric(key="ai_requests_month", label="AI Requests This Month", value=float(usage.requests_month)),
        DashboardMetric(key="documents_indexed", label="Indexed Documents", value=float(indexed_documents)),
        DashboardMetric(
            key="active_users" if scope != "personal" else "available_collections",
            label="Active Users" if scope != "personal" else "Available Collections",
            value=float(active_users if scope != "personal" else available_collections),
        ),
    ]

    department_usage: list[DashboardDepartmentUsage] = []
    if scope in {"platform", "organization"}:
        rows = (await session.execute(
            select(
                func.coalesce(Department.name, "General").label("department"),
                func.count(AIUsageEvent.id).filter(AIUsageEvent.operation == "chat").label("requests"),
                func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("cost"),
            )
            .select_from(AIUsageEvent)
            .outerjoin(Department, Department.id == AIUsageEvent.department_id)
            .where(AIUsageEvent.organization_id == user.organization_id, AIUsageEvent.created_at >= month_start)
            .group_by(Department.name)
            .order_by(func.sum(AIUsageEvent.cost_usd).desc())
        )).all()
        department_usage = [DashboardDepartmentUsage(department=row.department, requests=int(row.requests), cost=usd_to_inr(float(row.cost), exchange_rate)) for row in rows]

    documents_query = (
        select(KnowledgeDocument, KnowledgeCollection.name, User.full_name)
        .join(KnowledgeCollection, KnowledgeCollection.id == KnowledgeDocument.collection_id)
        .outerjoin(User, User.id == KnowledgeDocument.uploaded_by_user_id)
        .where(accessible_collection_filter)
    )
    if scope == "personal":
        documents_query = documents_query.where(
            or_(KnowledgeDocument.uploaded_by_user_id == user.id, KnowledgeCollection.is_shared.is_(True))
        )
    document_rows = (await session.execute(documents_query.order_by(KnowledgeDocument.created_at.desc()).limit(6))).all()
    recent_documents = [DashboardDocument(
        id=str(document.id), name=document.original_filename, collection=collection_name,
        uploader=uploader_name or "Former employee", status=document.status,
        version=document.version, created_at=document.created_at,
    ) for document, collection_name, uploader_name in document_rows]

    activity_query = (
        select(AuditEvent, User.full_name, Department.name)
        .outerjoin(User, User.id == AuditEvent.actor_user_id)
        .outerjoin(Department, Department.id == User.department_id)
        .where(*audit_filters)
    )
    if scope == "department":
        activity_query = activity_query.where(User.department_id == user.department_id)
    activity_rows = (await session.execute(activity_query.order_by(AuditEvent.created_at.desc()).limit(8))).all()
    recent_activity = [DashboardActivity(
        id=str(event.id), actor=actor or "System", action=event.action,
        department=department_name or "Organization", created_at=event.created_at,
    ) for event, actor, department_name in activity_rows]

    hr_action_center = None
    is_hr_admin = role_key == "super_admin" or bool(
        department_matches(department, "hr") and role_key == "department_admin"
    )
    if is_hr_admin:
        now = datetime.now(timezone.utc)
        reminder_documents = list(await session.scalars(select(KnowledgeDocument).where(
            KnowledgeDocument.organization_id == user.organization_id,
            KnowledgeDocument.status == "ready",
            KnowledgeDocument.expiry_date.is_not(None),
        )))
        due_reminders = sum(1 for item in reminder_documents if item.expiry_date <= now + timedelta(days=item.reminder_days_before))
        overdue_documents = sum(1 for item in reminder_documents if item.expiry_date < now)
        rule_documents = await session.scalar(select(func.count(KnowledgeDocument.id)).where(
            KnowledgeDocument.organization_id == user.organization_id,
            KnowledgeDocument.status == "ready",
            KnowledgeDocument.document_category.in_(["attendance_rule", "leave_rule", "hr_policy"]),
        )) or 0
        open_payroll_batches = await session.scalar(select(func.count(PayrollBatch.id)).where(
            PayrollBatch.organization_id == user.organization_id,
            PayrollBatch.status.in_(["draft", "partial", "failed"]),
        )) or 0
        asset_items = list(await session.scalars(select(ITAsset).where(ITAsset.organization_id == user.organization_id)))
        asset_attention = sum(maintenance_status(item)[0] in {"due", "overdue"} or item.status in {"Repair needed", "Recovery required", "Scrap proposed", "Approved for scrap"} for item in asset_items)
        asset_overdue = sum(maintenance_status(item)[0] == "overdue" for item in asset_items)
        hr_action_center = HRActionCenter(
            due_reminders=due_reminders,
            overdue_documents=overdue_documents,
            rule_documents=rule_documents,
            open_payroll_batches=open_payroll_batches,
            items=[
                HRActionItem(key="attendance", title="Review attendance", description="Analyze the month and work only on exceptions.", href="/department-tools/hr-attendance", tone="primary"),
                HRActionItem(key="leaves", title="Employee leave calculator", description="Merge attendance into the final salary Excel.", href="/hr/leave-calculator", tone="primary"),
                HRActionItem(key="letters", title="HR letters & templates", description="View, replace and use approved employee-letter templates.", href="/department-tools/hr-letters"),
                HRActionItem(key="payroll", title="Salary slips & templates", description="Manage unit templates, drafts and failed deliveries.", href="/hr/salary-slips", count=open_payroll_batches, tone="warning" if open_payroll_batches else "default"),
                HRActionItem(key="knowledge", title="Rules and reminders", description="Open HR documents, licences and renewal dates.", href="/knowledge/hr", count=due_reminders, tone="danger" if overdue_documents else "warning" if due_reminders else "default"),
                HRActionItem(key="assets", title="Asset Management", description="Add devices, schedule maintenance and manage scrap decisions.", href="/hr/assets", count=asset_attention, tone="danger" if asset_overdue else "warning" if asset_attention else "default"),
            ],
        )

    return DashboardOverview(
        currency="INR", usd_to_inr_rate=exchange_rate.rate, exchange_rate_source=exchange_rate.source,
        exchange_rate_updated_at=exchange_rate.updated_at,
        role_key=role_key, role_label=role_label, scope=scope, scope_label=scope_label,
        capabilities=CAPABILITIES[role_key], metrics=metrics, department_usage=department_usage,
        recent_documents=recent_documents, recent_activity=recent_activity,
        hr_action_center=hr_action_center,
        refreshed_at=datetime.now(timezone.utc),
    )
