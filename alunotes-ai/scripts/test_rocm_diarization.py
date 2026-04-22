"""ROCm diarization hang investigation.

Runs a graded sequence of torch + pyannote operations, printing timings for each
and installing a faulthandler watchdog that dumps a Python stack trace after
90 s if any single step stalls. That lets us pinpoint *which* op stalls — gemm,
conv1d, stft, a pyannote submodule — rather than guessing.

Invoke from alunotes-ai/:
    distrobox enter ubuntu24 -- env HSA_OVERRIDE_GFX_VERSION=10.3.0 \
        .venv/bin/python scripts/test_rocm_diarization.py
"""

from __future__ import annotations

import faulthandler
import os
import signal
import sys
import time
from contextlib import contextmanager
from pathlib import Path

faulthandler.enable()

HERE = Path(__file__).resolve().parent.parent
AUDIO = HERE / "test_audio.wav"


@contextmanager
def step(label: str, watchdog_seconds: int = 90):
    """Run a block, timing it, with a stack-dump watchdog if it stalls."""
    print(f"\n[step] {label} ...", flush=True)
    # Schedule a stack dump to stderr after `watchdog_seconds` seconds if the
    # block hasn't exited — cancelled on normal completion.
    faulthandler.dump_traceback_later(watchdog_seconds, exit=False)
    t0 = time.monotonic()
    try:
        yield
    finally:
        faulthandler.cancel_dump_traceback_later()
        dt = time.monotonic() - t0
        print(f"[step] {label} -> {dt:.2f}s", flush=True)


def main() -> int:
    assert AUDIO.exists(), f"missing test audio: {AUDIO}"

    print(f"python: {sys.version.split()[0]}")
    print(f"audio:  {AUDIO} ({AUDIO.stat().st_size/1024:.0f} KB)")
    print(f"env HSA_OVERRIDE_GFX_VERSION={os.environ.get('HSA_OVERRIDE_GFX_VERSION')}")

    # ── 1. Torch basics ───────────────────────────────────────────
    with step("import torch"):
        import torch

    print(f"torch: {torch.__version__}  hip={torch.version.hip}  cuda={torch.version.cuda}")
    print(f"cuda.is_available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"device:  {torch.cuda.get_device_name(0)}")

    device = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")

    # ── 2. gemm (known to work from our earlier test) ─────────────
    with step("gpu gemm 1024x1024"):
        a = torch.randn(1024, 1024, device=device)
        b = torch.randn(1024, 1024, device=device)
        (a @ b).sum().item()
        torch.cuda.synchronize() if device.type == "cuda" else None

    # ── 3. conv1d — pyannote's sincnet uses this heavily ──────────
    with step("gpu conv1d 1x1x16000 k=1024 stride=320"):
        x = torch.randn(1, 1, 16000, device=device)
        w = torch.randn(32, 1, 1024, device=device)
        y = torch.nn.functional.conv1d(x, w, stride=320)
        y.sum().item()
        torch.cuda.synchronize() if device.type == "cuda" else None
        print(f"        conv1d out shape: {tuple(y.shape)}")

    # ── 4. stft — audio feature extraction ────────────────────────
    with step("gpu stft n_fft=400 hop=160 on 5s audio"):
        x = torch.randn(80000, device=device)  # 5 s @ 16 kHz
        s = torch.stft(x, n_fft=400, hop_length=160, return_complex=True, window=torch.hann_window(400, device=device))
        s.abs().sum().item()
        torch.cuda.synchronize() if device.type == "cuda" else None
        print(f"        stft out shape: {tuple(s.shape)}")

    # ── 5. Load real audio ────────────────────────────────────────
    with step("load test_audio.wav via soundfile"):
        import soundfile as sf
        wav, sr = sf.read(str(AUDIO), dtype="float32", always_2d=False)
        print(f"        shape={wav.shape} sr={sr} dur={len(wav)/sr:.2f}s")

    # ── 6. pyannote on CPU (baseline) ─────────────────────────────
    with step("import pyannote.audio"):
        from pyannote.audio import Pipeline as PyannotePipeline

    token = os.environ.get("HF_TOKEN")
    with step("load pyannote pipeline on CPU", watchdog_seconds=180):
        pipeline_cpu = PyannotePipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1", token=token,
        )

    import numpy as np
    t = torch.from_numpy(np.asarray(wav, dtype=np.float32)).float()
    waveform = t.unsqueeze(0) if t.ndim == 1 else t.T
    inp = {"waveform": waveform, "sample_rate": int(sr)}

    # CPU baseline already measured at ~75s on this box; skip to focus the run
    # on the GPU path we're iterating on.
    # with step("run diarization on CPU", watchdog_seconds=240):
    #     out_cpu = pipeline_cpu(inp)
    #     diar = getattr(out_cpu, "speaker_diarization", out_cpu)
    #     turns_cpu = [(t.start, t.end, spk) for t, _, spk in diar.itertracks(yield_label=True)]
    # print(f"        cpu turns: {turns_cpu}")

    # ── 7. pyannote on GPU ────────────────────────────────────────
    # Standalone LSTM test showed nn.LSTM().to('cuda') takes ~37s on this box
    # — not a hang, first-time miopen kernel compile. The earlier pipeline-
    # level 180s watchdog was just too short. Give it 10 minutes and measure
    # cold vs warm cost to see whether GPU diarization is actually a win once
    # the kernel cache is populated.
    if device.type == "cuda":
        with step("load pyannote pipeline (CPU copy) and .to(GPU) [COLD]", watchdog_seconds=600):
            pipeline_gpu = PyannotePipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1", token=token,
            )
            pipeline_gpu = pipeline_gpu.to(device)

        waveform_gpu = waveform.to(device)
        inp_gpu = {"waveform": waveform_gpu, "sample_rate": int(sr)}

        with step("run diarization on GPU [COLD]", watchdog_seconds=600):
            out_gpu = pipeline_gpu(inp_gpu)
            diar = getattr(out_gpu, "speaker_diarization", out_gpu)
            turns_gpu = [(t.start, t.end, spk) for t, _, spk in diar.itertracks(yield_label=True)]
        print(f"        gpu turns (cold): {turns_gpu}")

        # Second run on same shape — kernel cache is now warm. If this is
        # significantly faster than the cold run and the CPU baseline, GPU
        # diarization is viable after a one-time warmup cost.
        with step("run diarization on GPU [WARM]", watchdog_seconds=300):
            out_gpu2 = pipeline_gpu(inp_gpu)
            diar2 = getattr(out_gpu2, "speaker_diarization", out_gpu2)
            turns_gpu2 = [(t.start, t.end, spk) for t, _, spk in diar2.itertracks(yield_label=True)]
        print(f"        gpu turns (warm): {turns_gpu2}")

    print("\nDONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
