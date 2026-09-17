import hashlib
import hmac
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db_session
from app.modules.document_generator.transcription import transcribe_document_audio
from app.modules.identity.authorization import require_department, require_permissions
from app.modules.identity.models import AIUsageEvent, User


PAIRING_TTL_SECONDS = 10 * 60
MAX_AUDIO_BYTES = 15 * 1024 * 1024
KEY_PREFIX = "qa-voice-pairing:"

desktop_router = APIRouter(dependencies=[Depends(require_department("r-d"))])
mobile_router = APIRouter()


class MobileTranscriptRequest(BaseModel):
    transcript: str = Field(default="", max_length=20000)
    listening: bool = False


def _key(pairing_id: str) -> str:
    return f"{KEY_PREFIX}{pairing_id}"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["Referrer-Policy"] = "no-referrer"


async def _mobile_session(request: Request, pairing_id: str, token: str) -> tuple[str, dict[str, str]]:
    key = _key(pairing_id)
    payload = await request.app.state.redis.hgetall(key)
    stored_hash = payload.get("token_hash", "")
    if not payload or not stored_hash or not hmac.compare_digest(_token_hash(token), stored_hash):
        raise HTTPException(status_code=404, detail="This phone pairing has expired or is invalid.")
    return key, payload


async def _desktop_session(request: Request, pairing_id: str, user: User) -> tuple[str, dict[str, str]]:
    key = _key(pairing_id)
    payload = await request.app.state.redis.hgetall(key)
    if not payload or payload.get("user_id") != str(user.id):
        raise HTTPException(status_code=404, detail="This phone pairing has expired or is unavailable.")
    return key, payload


def _public_state(pairing_id: str, payload: dict[str, str]) -> dict:
    return {
        "id": pairing_id,
        "status": payload.get("status", "waiting"),
        "pairing_code": payload.get("pairing_code", ""),
        "transcript": payload.get("transcript", ""),
        "revision": int(payload.get("revision", "0")),
        "expires_at": payload.get("expires_at", ""),
        "error": payload.get("error", ""),
    }


@desktop_router.post("/sessions")
async def create_voice_pairing(
    request: Request,
    response: Response,
    user: User = Depends(require_permissions("ai.workspace.use", "knowledge.read")),
) -> dict:
    _no_store(response)
    pairing_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    pairing_code = f"{secrets.randbelow(1_000_000):06d}"
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=PAIRING_TTL_SECONDS)
    await request.app.state.redis.hset(
        _key(pairing_id),
        mapping={
            "token_hash": _token_hash(token),
            "user_id": str(user.id),
            "organization_id": str(user.organization_id),
            "department_id": str(user.department_id or ""),
            "pairing_code": pairing_code,
            "status": "waiting",
            "transcript": "",
            "revision": "0",
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "error": "",
        },
    )
    await request.app.state.redis.expire(_key(pairing_id), PAIRING_TTL_SECONDS)
    return {
        "id": pairing_id,
        "token": token,
        "pairing_code": pairing_code,
        "status": "waiting",
        "expires_at": expires_at.isoformat(),
    }


@desktop_router.get("/sessions/{pairing_id}")
async def voice_pairing_status(
    pairing_id: str,
    request: Request,
    response: Response,
    user: User = Depends(require_permissions("ai.workspace.use", "knowledge.read")),
) -> dict:
    _no_store(response)
    _, payload = await _desktop_session(request, pairing_id, user)
    return _public_state(pairing_id, payload)


@desktop_router.delete("/sessions/{pairing_id}", status_code=204)
async def close_voice_pairing(
    pairing_id: str,
    request: Request,
    response: Response,
    user: User = Depends(require_permissions("ai.workspace.use", "knowledge.read")),
) -> None:
    _no_store(response)
    key, _ = await _desktop_session(request, pairing_id, user)
    await request.app.state.redis.delete(key)


@mobile_router.get("/mobile/{pairing_id}")
async def mobile_pairing_status(
    pairing_id: str,
    request: Request,
    response: Response,
    token: str = Header(alias="X-Voice-Pairing-Token"),
) -> dict:
    _no_store(response)
    key, payload = await _mobile_session(request, pairing_id, token)
    if payload.get("status") == "waiting":
        await request.app.state.redis.hset(key, mapping={"status": "connected"})
        payload["status"] = "connected"
    return _public_state(pairing_id, payload)


@mobile_router.post("/mobile/{pairing_id}/transcript")
async def update_mobile_transcript(
    pairing_id: str,
    payload: MobileTranscriptRequest,
    request: Request,
    response: Response,
    token: str = Header(alias="X-Voice-Pairing-Token"),
) -> dict:
    _no_store(response)
    key, current = await _mobile_session(request, pairing_id, token)
    revision = int(current.get("revision", "0")) + 1
    await request.app.state.redis.hset(
        key,
        mapping={
            "transcript": payload.transcript.strip(),
            "revision": str(revision),
            "status": "listening" if payload.listening else "connected",
            "error": "",
        },
    )
    return {"status": "ok", "revision": revision}


@mobile_router.post("/mobile/{pairing_id}/complete")
async def complete_mobile_recording(
    pairing_id: str,
    request: Request,
    response: Response,
    token: str = Header(alias="X-Voice-Pairing-Token"),
    audio_file: UploadFile | None = File(None),
    browser_transcript: str = Form(""),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    _no_store(response)
    key, pairing = await _mobile_session(request, pairing_id, token)
    browser_text = browser_transcript.strip()[:20000]
    await request.app.state.redis.hset(key, mapping={"status": "processing", "error": ""})
    professional_text = ""
    if audio_file is not None:
        content = await audio_file.read(MAX_AUDIO_BYTES + 1)
        if len(content) > MAX_AUDIO_BYTES:
            await request.app.state.redis.hset(
                key,
                mapping={"status": "error", "error": "The voice recording exceeds the 15 MB limit."},
            )
            raise HTTPException(status_code=413, detail="The voice recording exceeds the 15 MB limit.")
        if content:
            started = time.perf_counter()
            try:
                professional_text = await transcribe_document_audio(
                    content,
                    audio_file.filename or "qa-mobile-voice.webm",
                    audio_file.content_type or "audio/webm",
                )
            except HTTPException:
                if not browser_text:
                    await request.app.state.redis.hset(
                        key,
                        mapping={"status": "error", "error": "Voice transcription was unavailable. Please try again."},
                    )
                    raise
            if professional_text:
                user = await session.get(User, uuid.UUID(pairing["user_id"]))
                if user:
                    settings = get_settings()
                    session.add(AIUsageEvent(
                        organization_id=user.organization_id,
                        user_id=user.id,
                        department_id=user.department_id,
                        operation="document_transcription",
                        provider="openai",
                        model=settings.openai_transcription_model,
                        input_tokens=0,
                        output_tokens=0,
                        cost_usd=0,
                        latency_ms=int((time.perf_counter() - started) * 1000),
                        status="completed",
                    ))
                    await session.commit()
    if professional_text and browser_text and professional_text.lower() != browser_text.lower():
        final_text = f"Professional audio transcript:\n{professional_text}\n\nBrowser transcript of the same speech:\n{browser_text}"
    else:
        final_text = professional_text or browser_text
    if not final_text:
        await request.app.state.redis.hset(
            key,
            mapping={"status": "error", "error": "No clear speech was captured. Please try again."},
        )
        raise HTTPException(status_code=422, detail="No clear speech was captured. Please try again.")
    revision = int(pairing.get("revision", "0")) + 1
    await request.app.state.redis.hset(
        key,
        mapping={
            "transcript": final_text[:40000],
            "revision": str(revision),
            "status": "ready",
            "error": "",
        },
    )
    return {"status": "ready", "revision": revision}


@mobile_router.delete("/mobile/{pairing_id}", status_code=204)
async def cancel_mobile_pairing(
    pairing_id: str,
    request: Request,
    response: Response,
    token: str = Header(alias="X-Voice-Pairing-Token"),
) -> None:
    _no_store(response)
    key, _ = await _mobile_session(request, pairing_id, token)
    await request.app.state.redis.hset(
        key,
        mapping={"status": "cancelled", "transcript": "", "error": ""},
    )
    await request.app.state.redis.expire(key, 60)
