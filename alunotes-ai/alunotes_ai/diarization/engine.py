"""Speaker diarization engine using pyannote.audio + Qwen3-ASR.

Pipeline (memory-efficient, no forced aligner needed):
  1. Diarization: audio -> speaker segments with timestamps (pyannote, tiny model)
  2. ASR per segment: extract audio slice per speaker turn -> transcribe each

This avoids loading the forced aligner (~1.2GB) entirely, keeping peak RAM
under control on 16GB devices.
"""

import asyncio
import io
import os
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

import numpy as np
import soundfile as sf

# Offline mode is enforced by the Dockerfile in prod. Dev-mode `make run-all`
# relies on the host's HF cache and should be free to fetch if it's cold.
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("DO_NOT_TRACK", "1")

import torch
from pyannote.audio import Pipeline as PyannotePipeline

from ..asr.engine import transcribe_sync
from ..config import settings
from ..memory import mem


@dataclass
class DiarizedSegment:
    speaker: str
    start: float
    end: float
    text: str


_diarization_pipeline: PyannotePipeline | None = None


def _get_diarization_pipeline() -> PyannotePipeline:
    global _diarization_pipeline
    if _diarization_pipeline is not None:
        return _diarization_pipeline

    # Prod (docker): weights are baked into the image cache, HF_HUB_OFFLINE=1
    #   is set by the Dockerfile, and HF_TOKEN is absent — token=None is fine.
    # Dev (run-all): cache may be cold; HF_TOKEN from alunotes-ai/.env lets us
    #   fetch the gated pyannote repos the first time.
    _diarization_pipeline = PyannotePipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=os.environ.get("HF_TOKEN"),
    )

    device = settings.asr_device
    if device != "cpu":
        _diarization_pipeline = _diarization_pipeline.to(torch.device(device))

    return _diarization_pipeline


def _load_audio(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    with io.BytesIO(audio_bytes) as f:
        wav, sr = sf.read(f, dtype="float32", always_2d=False)
    return np.asarray(wav, dtype=np.float32), int(sr)


def _extract_slice(wav: np.ndarray, sr: int, start: float, end: float) -> bytes:
    """Extract an audio slice and return as WAV bytes."""
    start_sample = int(start * sr)
    end_sample = min(int(end * sr), len(wav))
    if start_sample >= end_sample:
        return b""
    segment = wav[start_sample:end_sample]
    buf = io.BytesIO()
    sf.write(buf, segment, sr, format="WAV")
    buf.seek(0)
    return buf.read()


def _run_pyannote(audio_bytes: bytes) -> list[dict]:
    """Run pyannote speaker diarization (blocking). Returns speaker turns."""
    mem.acquire("diarization")
    wav, sr = _load_audio(audio_bytes)
    pipeline = _get_diarization_pipeline()

    t = torch.from_numpy(wav).float()
    if t.ndim == 1:
        # mono: (samples,) -> (1, samples)
        waveform = t.unsqueeze(0)
    else:
        # stereo: (samples, channels) -> (channels, samples)
        waveform = t.T
    output = pipeline({"waveform": waveform, "sample_rate": sr})

    # pyannote >=4 returns DiarizeOutput dataclass; <=3 returns Annotation directly
    diarization = getattr(output, "speaker_diarization", output)

    turns: list[dict] = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        turns.append({"start": turn.start, "end": turn.end, "speaker": speaker})
    return turns


def _transcribe_segment(audio_bytes: bytes, language: str | None) -> str:
    """Transcribe a single audio segment (blocking). Loads ASR if needed."""
    if not audio_bytes:
        return ""
    results = transcribe_sync(audio_bytes, language=language, return_time_stamps=False)
    return " ".join(r["text"] for r in results if r["text"]).strip()


async def diarize_with_progress(
    audio: bytes | Path,
    language: str | None = None,
) -> AsyncIterator[dict]:
    """Run diarization pipeline, yielding SSE progress events.

    Pipeline:
      1. pyannote (tiny) -> speaker turns with timestamps
      2. ASR (no forced aligner) per speaker turn -> text

    Event types:
      - progress: {type, stage, message}
      - segment:  {type, speaker, start, end, text}
      - done:     {type, total_segments}
      - error:    {type, message}
    """
    if isinstance(audio, Path):
        audio = audio.read_bytes()

    try:
        # Step 1: Speaker diarization (pyannote is small, runs fast)
        yield {"type": "progress", "stage": "loading_diarization", "message": "Loading speaker diarization model..."}

        turns = await asyncio.to_thread(_run_pyannote, audio)

        speakers = {t["speaker"] for t in turns}
        yield {
            "type": "progress",
            "stage": "diarization_done",
            "message": f"Found {len(speakers)} speaker(s), {len(turns)} turn(s)",
        }

        if not turns:
            yield {"type": "done", "total_segments": 0}
            return

        # Step 2: Transcribe each speaker turn via ASR (no forced aligner)
        yield {"type": "progress", "stage": "loading_asr", "message": "Loading ASR model..."}

        wav, sr = _load_audio(audio)
        total = len(turns)
        segments: list[DiarizedSegment] = []

        for i, turn in enumerate(turns):
            # Extract audio slice for this turn
            slice_bytes = _extract_slice(wav, sr, turn["start"], turn["end"])

            if not slice_bytes:
                continue

            yield {
                "type": "progress",
                "stage": "transcribing",
                "message": f"Transcribing turn {i + 1}/{total} ({turn['speaker']})...",
            }

            text = await asyncio.to_thread(
                _transcribe_segment, slice_bytes, language
            )

            if text:
                seg = DiarizedSegment(
                    speaker=turn["speaker"],
                    start=round(turn["start"], 3),
                    end=round(turn["end"], 3),
                    text=text,
                )
                segments.append(seg)

                yield {
                    "type": "segment",
                    "speaker": seg.speaker,
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text,
                }

        yield {"type": "done", "total_segments": len(segments)}

    except Exception as e:
        yield {"type": "error", "message": str(e)}


def warmup_diarization() -> None:
    """Pre-compile MIOpen kernels before the first real request.

    On AMD ROCm (esp. RDNA2 APUs with HSA_OVERRIDE) the first diarization
    forward pass triggers MIOpen to JIT-compile ~dozens of HIP kernels,
    taking 100-200 s. Results are cached in ~/.cache/miopen, so subsequent
    runs are fast. Calling this at server startup shifts the cost out of
    the user's first request and into boot.

    Silently no-ops on CPU (no benefit — nothing to warm) and swallows
    errors (warmup is best-effort; a failure here shouldn't block serving).
    """
    if settings.asr_device == "cpu":
        return
    try:
        pipeline = _get_diarization_pipeline()
        silence = np.zeros(16000, dtype=np.float32)  # 1 s @ 16 kHz
        t = torch.from_numpy(silence).unsqueeze(0)
        pipeline({"waveform": t, "sample_rate": 16000})
    except Exception:
        import logging
        logging.getLogger(__name__).exception("diarization warmup failed — continuing anyway")


def diarize_sync(audio: bytes | Path, language: str | None = None) -> list[DiarizedSegment]:
    """Synchronous version for tests."""
    if isinstance(audio, Path):
        audio = audio.read_bytes()

    turns = _run_pyannote(audio)
    if not turns:
        return []

    wav, sr = _load_audio(audio)
    segments: list[DiarizedSegment] = []

    for turn in turns:
        slice_bytes = _extract_slice(wav, sr, turn["start"], turn["end"])
        if not slice_bytes:
            continue

        text = _transcribe_segment(slice_bytes, language=None)
        if text:
            segments.append(DiarizedSegment(
                speaker=turn["speaker"],
                start=round(turn["start"], 3),
                end=round(turn["end"], 3),
                text=text,
            ))

    return segments
