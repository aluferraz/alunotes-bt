"""Audio resampling utilities.

Ensures audio is 16kHz mono float32 before ASR inference.
Uses torchaudio if available, falls back to ffmpeg subprocess.
"""

import logging
import subprocess
import tempfile

import numpy as np

logger = logging.getLogger(__name__)

TARGET_SR = 16000


def ensure_16k_mono(wav: np.ndarray, sr: int) -> tuple[np.ndarray, int]:
    """Convert audio to 16kHz mono float32.

    Args:
        wav: Audio array, shape (samples,) or (samples, channels).
        sr: Sample rate of input audio.

    Returns:
        Tuple of (resampled_wav, 16000).
    """
    # Convert to mono if stereo
    if wav.ndim > 1:
        wav = wav.mean(axis=-1)

    wav = wav.astype(np.float32)

    if sr == TARGET_SR:
        return wav, TARGET_SR

    # Try torchaudio first
    try:
        return _resample_torchaudio(wav, sr), TARGET_SR
    except Exception:
        pass

    # Fallback to ffmpeg
    try:
        return _resample_ffmpeg(wav, sr), TARGET_SR
    except Exception:
        logger.warning("resample: both torchaudio and ffmpeg failed, returning original at %dHz", sr)
        return wav, sr


def _resample_torchaudio(wav: np.ndarray, sr: int) -> np.ndarray:
    """Resample using torchaudio.transforms.Resample."""
    import torch
    import torchaudio

    resampler = torchaudio.transforms.Resample(orig_freq=sr, new_freq=TARGET_SR)
    tensor = torch.from_numpy(wav).float()
    resampled = resampler(tensor)
    return resampled.numpy()


def _resample_ffmpeg(wav: np.ndarray, sr: int) -> np.ndarray:
    """Resample using ffmpeg subprocess."""
    import soundfile as sf

    # Write input to temp file
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp_in:
        sf.write(tmp_in.name, wav, sr, format="WAV")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp_out:
            result = subprocess.run(
                [
                    "ffmpeg", "-y", "-i", tmp_in.name,
                    "-ar", str(TARGET_SR), "-ac", "1",
                    "-f", "wav", tmp_out.name,
                ],
                capture_output=True,
                timeout=30,
            )
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()}")

            resampled, _ = sf.read(tmp_out.name, dtype="float32")
            return np.asarray(resampled, dtype=np.float32)
