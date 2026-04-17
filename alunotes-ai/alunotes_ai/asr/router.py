"""ASR HTTP endpoint with SSE progress events."""

import json

from fastapi import APIRouter, HTTPException, Query, UploadFile
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from .engine import transcribe_sync, transcribe_with_progress
from .filters import filter_hallucinations
from .srt import segments_to_srt

router = APIRouter()


@router.post("/v1/asr/transcribe")
async def asr_transcribe(
    audio: UploadFile,
    language: str | None = None,
    format: str = Query(default="text", pattern="^(text|srt)$"),
) -> EventSourceResponse:
    if audio.content_type and not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {audio.content_type}")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    if format == "srt":
        if not settings.use_forced_aligner:
            raise HTTPException(status_code=400, detail="SRT format requires forced aligner (use_forced_aligner=True)")
        return await _srt_response(audio_bytes, language)

    async def _stream():
        async for event in transcribe_with_progress(audio_bytes, language=language):
            # Apply hallucination filter to transcript text
            if event["type"] == "transcript" and settings.use_hallucination_filter:
                event["text"] = filter_hallucinations(event["text"])
            yield {"event": event["type"], "data": json.dumps(event)}

    return EventSourceResponse(_stream())


async def _srt_response(audio_bytes: bytes, language: str | None) -> EventSourceResponse:
    """Return SRT-formatted transcription as SSE."""
    import asyncio

    async def _stream():
        try:
            progress = {"type": "progress", "stage": "loading_model", "message": "Loading ASR model with aligner..."}
            yield {"event": "progress", "data": json.dumps(progress)}

            results = await asyncio.to_thread(
                transcribe_sync, audio_bytes, language, True
            )

            # Gather all segments with timestamps
            segments = []
            for r in results:
                if r.get("time_stamps"):
                    segments.extend(r["time_stamps"])

            srt_text = segments_to_srt(segments)
            if settings.use_hallucination_filter:
                srt_text = filter_hallucinations(srt_text)

            yield {"event": "srt", "data": json.dumps({"type": "srt", "text": srt_text})}
            yield {"event": "done", "data": json.dumps({"type": "done"})}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"type": "error", "message": str(e)})}

    return EventSourceResponse(_stream())
