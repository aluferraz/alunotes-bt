"""VAD-based chunking for long audio files.

For files longer than a threshold (default 3 minutes), splits on silence
boundaries using Silero VAD to prevent OOM on memory-constrained devices.
"""

import logging
from typing import Optional

import numpy as np
import torch

logger = logging.getLogger(__name__)

_vad_model: Optional[object] = None
_vad_utils: Optional[tuple] = None


def _get_vad_model():
    """Lazy-load Silero VAD model from torch.hub."""
    global _vad_model, _vad_utils
    if _vad_model is not None:
        return _vad_model, _vad_utils

    model, utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        trust_repo=True,
    )
    _vad_model = model
    _vad_utils = utils
    return _vad_model, _vad_utils


def vad_split(
    wav: np.ndarray,
    sr: int,
    min_duration: float = 180.0,
    min_chunk_duration: float = 5.0,
    max_chunk_duration: float = 120.0,
) -> list[np.ndarray]:
    """Split audio on silence boundaries using Silero VAD.

    Only splits if audio is longer than `min_duration` seconds.
    Returns the original audio as a single-element list if shorter.

    Args:
        wav: Audio array (mono, float32).
        sr: Sample rate.
        min_duration: Minimum audio duration (seconds) to trigger splitting.
        min_chunk_duration: Minimum chunk length in seconds.
        max_chunk_duration: Maximum chunk length in seconds.

    Returns:
        List of audio chunks as numpy arrays.
    """
    duration = len(wav) / sr
    if duration < min_duration:
        return [wav]

    logger.info("vad: splitting %.1fs audio into chunks", duration)

    try:
        model, utils = _get_vad_model()
        get_speech_timestamps = utils[0]

        tensor = torch.from_numpy(wav).float()

        # Get speech timestamps
        speech_timestamps = get_speech_timestamps(
            tensor,
            model,
            sampling_rate=sr,
            min_silence_duration_ms=500,
            min_speech_duration_ms=int(min_chunk_duration * 1000),
        )

        if not speech_timestamps:
            logger.warning("vad: no speech detected, returning full audio")
            return [wav]

        # Merge timestamps into chunks respecting max_chunk_duration
        chunks = _merge_into_chunks(
            wav, sr, speech_timestamps, max_chunk_duration
        )

        logger.info("vad: split into %d chunks", len(chunks))
        return chunks

    except Exception as e:
        logger.warning("vad: splitting failed (%s), returning full audio", e)
        return [wav]


def _merge_into_chunks(
    wav: np.ndarray,
    sr: int,
    timestamps: list[dict],
    max_duration: float,
) -> list[np.ndarray]:
    """Merge speech timestamps into chunks, respecting max duration."""
    max_samples = int(max_duration * sr)
    chunks: list[np.ndarray] = []
    current_start = timestamps[0]["start"]
    current_end = timestamps[0]["end"]

    for ts in timestamps[1:]:
        proposed_end = ts["end"]
        if proposed_end - current_start > max_samples:
            # Emit current chunk
            chunks.append(wav[current_start:current_end])
            current_start = ts["start"]
            current_end = ts["end"]
        else:
            current_end = proposed_end

    # Emit last chunk
    chunks.append(wav[current_start:current_end])

    return chunks
