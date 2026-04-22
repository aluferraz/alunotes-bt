"""ASR engine wrapping Qwen3-ASR toolkit.

Callers interact only with transcribe() — the toolkit is an internal detail.

On memory-constrained devices (e.g. 16GB Pi), the memory manager ensures
only one model is loaded at a time. ASR acquires the "asr" slot, which
first unloads diarization if active.
"""

import gc
import io
import os
from pathlib import Path
from typing import AsyncIterator

import numpy as np
import soundfile as sf

# Disable HuggingFace telemetry before any transformers import. Offline mode
# (HF_HUB_OFFLINE / TRANSFORMERS_OFFLINE) is set by the Dockerfile for prod
# runs — we deliberately don't force it here so `make run-all` in dev mode
# can still fall back to a host HF fetch when the cache is cold.
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("DO_NOT_TRACK", "1")

import torch
from qwen_asr import Qwen3ASRModel

from ..config import settings
from ..memory import mem

_model: Qwen3ASRModel | None = None
_model_has_aligner: bool = False


def _get_device_dtype() -> tuple[str, torch.dtype]:
    device = settings.asr_device
    dtype = torch.float32
    if device.startswith("cuda"):
        dtype = torch.bfloat16
    return device, dtype


def _get_model(need_aligner: bool = False) -> Qwen3ASRModel:
    global _model, _model_has_aligner

    if _model is not None and need_aligner and not _model_has_aligner:
        del _model
        _model = None
        gc.collect()

    if _model is not None:
        return _model

    mem.acquire("asr")

    device, dtype = _get_device_dtype()

    aligner_path = settings.asr_forced_aligner_path if need_aligner else None
    aligner_kwargs = dict(dtype=dtype, device_map=device) if need_aligner else None

    kwargs: dict = dict(
        dtype=dtype,
        device_map=device,
        forced_aligner=aligner_path,
        forced_aligner_kwargs=aligner_kwargs,
        max_inference_batch_size=settings.asr_max_batch_size,
    )
    if settings.asr_max_new_tokens is not None:
        kwargs["max_new_tokens"] = settings.asr_max_new_tokens

    _model = Qwen3ASRModel.from_pretrained(settings.asr_model_path, **kwargs)
    _model_has_aligner = need_aligner
    return _model


def _load_audio_bytes(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    with io.BytesIO(audio_bytes) as f:
        wav, sr = sf.read(f, dtype="float32", always_2d=False)
    return np.asarray(wav, dtype=np.float32), int(sr)


def transcribe_sync(
    audio: bytes | Path,
    language: str | None = None,
    return_time_stamps: bool = False,
) -> list[dict]:
    """Transcribe audio synchronously. Returns list of {language, text, time_stamps}."""
    # Skip forced aligner if disabled in settings
    if return_time_stamps and not settings.use_forced_aligner:
        return_time_stamps = False

    model = _get_model(need_aligner=return_time_stamps)

    if isinstance(audio, Path):
        audio = audio.read_bytes()

    wav, sr = _load_audio_bytes(audio)

    # Resample to 16kHz mono if enabled
    if settings.use_resampling:
        from .resample import ensure_16k_mono
        wav, sr = ensure_16k_mono(wav, sr)

    # VAD-based chunking for long audio
    from .vad import vad_split
    chunks = vad_split(wav, sr)

    all_results = []
    for chunk in chunks:
        results = model.transcribe(
            audio=(chunk, sr),
            language=language,
            return_time_stamps=return_time_stamps,
        )
        all_results.extend(results)

    return [
        {
            "language": r.language,
            "text": r.text,
            "time_stamps": (
                [{"text": ts.text, "start_time": ts.start_time, "end_time": ts.end_time} for ts in r.time_stamps]
                if r.time_stamps
                else None
            ),
        }
        for r in all_results
    ]


async def transcribe_with_progress(
    audio: bytes | Path,
    language: str | None = None,
) -> AsyncIterator[dict]:
    """Transcribe audio, yielding SSE progress events.

    Blocking model calls run in a thread pool so the event loop can
    send SSE events and keepalives.

    Event types:
      - progress:   {type, stage, message}
      - transcript: {type, language, text}
      - done:       {type}
      - error:      {type, message}
    """
    import asyncio

    try:
        yield {"type": "progress", "stage": "loading_model", "message": "Loading ASR model..."}

        results = await asyncio.to_thread(
            transcribe_sync, audio, language, False
        )

        for r in results:
            yield {
                "type": "transcript",
                "language": r["language"],
                "text": r["text"],
            }

        yield {"type": "done"}

    except Exception as e:
        yield {"type": "error", "message": str(e)}


async def transcribe(
    audio: bytes | Path,
    language: str | None = None,
) -> AsyncIterator[str]:
    """Legacy: yield only text chunks."""
    results = transcribe_sync(audio, language=language, return_time_stamps=False)
    for r in results:
        yield r["text"]
