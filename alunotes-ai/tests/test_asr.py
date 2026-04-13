"""Integration tests for the ASR transcribe endpoint.

Tests correspond to the example files under context-data/Qwen3-ASR/examples/.
These tests require:
  - ASR models pre-cached locally (TRANSFORMERS_OFFLINE=1 enforced in conftest)
  - Audio fixture files in tests/fixtures/ (or network access for initial download)
"""

import io
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from httpx import AsyncClient

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _generate_sine_wav(duration_s: float = 2.0, sr: int = 16000, freq: float = 440.0) -> bytes:
    """Generate a simple sine wave WAV file as bytes (for testing endpoint plumbing)."""
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False, dtype=np.float32)
    wav = 0.5 * np.sin(2 * np.pi * freq * t)
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV")
    buf.seek(0)
    return buf.read()


def _asr_model_available() -> bool:
    """Check if the ASR model is cached locally."""
    try:
        # Must register qwen3_asr model type before AutoConfig can find it
        import qwen_asr.inference.qwen3_asr  # noqa: F401
        from transformers import AutoConfig
        AutoConfig.from_pretrained("Qwen/Qwen3-ASR-0.6B", local_files_only=True)
        return True
    except Exception:
        return False


requires_asr_model = pytest.mark.skipif(
    not _asr_model_available(),
    reason="Qwen3-ASR-0.6B not cached locally"
)


@pytest.mark.asyncio
async def test_transcribe_rejects_non_audio(client: AsyncClient):
    """POST /v1/asr/transcribe with non-audio content type should return 415."""
    resp = await client.post(
        "/v1/asr/transcribe",
        files={"audio": ("test.txt", b"not audio", "text/plain")},
    )
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_transcribe_rejects_empty(client: AsyncClient):
    """POST /v1/asr/transcribe with empty body should return 400."""
    resp = await client.post(
        "/v1/asr/transcribe",
        files={"audio": ("empty.wav", b"", "audio/wav")},
    )
    assert resp.status_code == 400


# --- Model-dependent tests (require pre-cached ASR models) ---
# These mirror the context-data/Qwen3-ASR/examples/ test cases.


@requires_asr_model
@pytest.mark.asyncio
async def test_transcribe_endpoint_accepts_audio(client: AsyncClient):
    """POST /v1/asr/transcribe with a WAV file should return 200 with SSE response."""
    wav_bytes = _generate_sine_wav(duration_s=1.0)
    resp = await client.post(
        "/v1/asr/transcribe",
        files={"audio": ("test.wav", wav_bytes, "audio/wav")},
    )
    assert resp.status_code == 200


@requires_asr_model
@pytest.mark.asyncio
async def test_transcribe_transformers_single(client: AsyncClient):
    """Corresponds to example_qwen3_asr_transformers.py — single URL audio."""
    fixture = FIXTURES_DIR / "asr_en.wav"
    if fixture.exists():
        wav_bytes = fixture.read_bytes()
    else:
        wav_bytes = _generate_sine_wav(duration_s=3.0)

    resp = await client.post(
        "/v1/asr/transcribe",
        files={"audio": ("audio.wav", wav_bytes, "audio/wav")},
        params={"language": "English"},
    )
    assert resp.status_code == 200
    body = resp.text
    assert len(body.strip()) > 0


@requires_asr_model
@pytest.mark.asyncio
async def test_transcribe_vllm_single(client: AsyncClient):
    """Corresponds to example_qwen3_asr_vllm.py — single URL audio via vLLM."""
    fixture = FIXTURES_DIR / "asr_zh.wav"
    if fixture.exists():
        wav_bytes = fixture.read_bytes()
    else:
        wav_bytes = _generate_sine_wav(duration_s=3.0)

    resp = await client.post(
        "/v1/asr/transcribe",
        files={"audio": ("audio.wav", wav_bytes, "audio/wav")},
    )
    assert resp.status_code == 200
    body = resp.text
    assert len(body.strip()) > 0


@requires_asr_model
@pytest.mark.asyncio
async def test_transcribe_vllm_streaming(client: AsyncClient):
    """Corresponds to example_qwen3_asr_vllm_streaming.py — streaming ASR."""
    fixture = FIXTURES_DIR / "asr_en.wav"
    if fixture.exists():
        wav_bytes = fixture.read_bytes()
    else:
        wav_bytes = _generate_sine_wav(duration_s=2.0)

    resp = await client.post(
        "/v1/asr/transcribe",
        files={"audio": ("audio.wav", wav_bytes, "audio/wav")},
        params={"language": "English"},
    )
    assert resp.status_code == 200
    body = resp.text
    assert len(body.strip()) > 0


@requires_asr_model
@pytest.mark.asyncio
async def test_transcribe_forced_aligner(client: AsyncClient):
    """Corresponds to example_qwen3_forced_aligner.py — timestamp alignment."""
    fixture = FIXTURES_DIR / "asr_en.wav"
    if fixture.exists():
        wav_bytes = fixture.read_bytes()
    else:
        wav_bytes = _generate_sine_wav(duration_s=3.0)

    resp = await client.post(
        "/v1/asr/transcribe",
        files={"audio": ("audio.wav", wav_bytes, "audio/wav")},
        params={"language": "English"},
    )
    assert resp.status_code == 200
