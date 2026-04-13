"""ASR HTTP endpoint with SSE progress events."""

import json

from fastapi import APIRouter, HTTPException, UploadFile
from sse_starlette.sse import EventSourceResponse

from .engine import transcribe_with_progress

router = APIRouter()


@router.post("/v1/asr/transcribe")
async def asr_transcribe(
    audio: UploadFile,
    language: str | None = None,
) -> EventSourceResponse:
    if audio.content_type and not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {audio.content_type}")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    async def _stream():
        async for event in transcribe_with_progress(audio_bytes, language=language):
            yield {"event": event["type"], "data": json.dumps(event)}

    return EventSourceResponse(_stream())
