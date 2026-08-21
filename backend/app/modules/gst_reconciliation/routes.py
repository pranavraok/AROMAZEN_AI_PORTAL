from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.modules.gst_reconciliation.service import reconcile
from app.modules.identity.authorization import require_permissions
from app.modules.identity.models import AuditEvent, Department, User
from app.modules.identity.service import role_keys_for_user

router = APIRouter()


async def ensure_accounts_team(user: User, session: AsyncSession) -> None:
    roles = await role_keys_for_user(session, user.id)
    if "super_admin" in roles:
        return
    department = await session.get(Department, user.department_id) if user.department_id else None
    if not department or department.slug != "accounts" or not roles.intersection({"department_admin", "employee"}):
        raise HTTPException(status_code=403, detail="GST Reconciliation is available to Admin and the Accounts team.")


async def _read_excel(file: UploadFile, label: str, limit: int = 20 * 1024 * 1024) -> bytes:
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=422, detail=f"Upload {label} as an .xlsx file.")
    content = await file.read(limit + 1)
    if not content or len(content) > limit:
        raise HTTPException(status_code=422, detail=f"{label} must be a non-empty Excel file smaller than 20 MB.")
    return content


@router.post("/analyze")
async def analyze(
    purchase_register: UploadFile = File(...), journal_register: UploadFile = File(...),
    gstr2b_portal: UploadFile = File(...), user: User = Depends(require_permissions("ai.workspace.use")),
    session: AsyncSession = Depends(get_db_session),
):
    await ensure_accounts_team(user, session)
    purchase = await _read_excel(purchase_register, "Tally Purchase Register")
    journal = await _read_excel(journal_register, "Tally Journal Register")
    portal = await _read_excel(gstr2b_portal, "GST Portal GSTR-2B")
    try:
        result = await run_in_threadpool(reconcile, purchase, journal, portal)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    summary = result["summary"]
    session.add(AuditEvent(
        organization_id=user.organization_id, actor_user_id=user.id, action="gst_reconciliation.analyzed",
        target_type="gst_reconciliation", target_id=result.get("period") or None,
        metadata_json={key: summary[key] for key in ("book_invoices", "portal_invoices", "matched", "mismatched", "books_only", "portal_only", "incomplete_books", "duplicates")},
    ))
    await session.commit()
    return result
