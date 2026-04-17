"""Diarization HTTP endpoint with SSE progress events."""

import json
import logging

from fastapi import APIRouter, HTTPException, UploadFile
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from .engine import diarize_with_progress

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/v1/asr/diarize")
async def asr_diarize(
    audio: UploadFile,
    language: str | None = None,
) -> EventSourceResponse:
    if not settings.use_diarization:
        raise HTTPException(status_code=501, detail="Diarization is disabled")

    if audio.content_type and not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {audio.content_type}")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    async def _stream():
        async for event in diarize_with_progress(audio_bytes, language=language):
            yield {"event": event["type"], "data": json.dumps(event)}

    return EventSourceResponse(_stream())
