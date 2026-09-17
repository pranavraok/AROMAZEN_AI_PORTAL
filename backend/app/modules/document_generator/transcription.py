import json

import httpx
from fastapi import HTTPException

from app.core.config import get_settings


COA_TRANSCRIPTION_PROMPT = (
    "AROMAZEN professional COA and SDS dictation. Vocabulary: Name of Product, Product Code, "
    "Batch Number, Customer Name, Date of Manufacturing, Expiry Date, Quantity, Storage Condition, "
    "Appearance, pale yellowish liquid, Odour, Specific Gravity, Flash Point, Fire Point, Refractive "
    "Index, Tested By, Checked By. Preserve individually spoken letters exactly, especially F P versus "
    "S P. Preserve complete four-digit years such as 2028. Preserve verbal numeric ranges such as "
    "0.85 to 1.15. Preserve corrections such as sorry, no, correct that to, and change that to."
)


async def transcribe_document_audio(content: bytes, filename: str, content_type: str) -> str:
    """Transcribe one in-memory recording. The bytes are never written to storage."""
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="Professional voice transcription is not configured. The visible browser transcript can still be used.",
        )
    try:
        timeout = httpx.Timeout(
            settings.ai_request_timeout_seconds,
            connect=settings.ai_connect_timeout_seconds,
        )
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                files={"file": (filename, content, content_type)},
                data={
                    "model": settings.openai_transcription_model,
                    "response_format": "json",
                    "prompt": COA_TRANSCRIPTION_PROMPT,
                },
            )
        if response.status_code >= 400:
            raise HTTPException(
                status_code=503,
                detail="The full voice recording could not be transcribed. Please review the visible transcript and try Done again.",
            )
        payload = response.json()
        text = str(payload.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="No clear speech was found in the recording.")
        return text
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="The full voice recording could not be transcribed. Please review the visible transcript and try Done again.",
        ) from exc
