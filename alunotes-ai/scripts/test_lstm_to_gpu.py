"""Minimal reproducer: does `nn.LSTM().to('cuda')` hang on this box?

No pyannote, no HF downloads — just a standalone LSTM. If this hangs, we've
isolated the fault to PyTorch/ROCm's LSTM path and can iterate on env-var
workarounds fast.

Invoke from alunotes-ai/:
    distrobox enter ubuntu24 -- env HSA_OVERRIDE_GFX_VERSION=10.3.0 \
        .venv/bin/python scripts/test_lstm_to_gpu.py
"""

from __future__ import annotations

import faulthandler
import os
import sys
import time
from contextlib import contextmanager

faulthandler.enable()


@contextmanager
def step(label: str, watchdog_seconds: int = 60):
    print(f"\n[step] {label} ...", flush=True)
    faulthandler.dump_traceback_later(watchdog_seconds, exit=False)
    t0 = time.monotonic()
    try:
        yield
    finally:
        faulthandler.cancel_dump_traceback_later()
        print(f"[step] {label} -> {time.monotonic()-t0:.2f}s", flush=True)


def main() -> int:
    print(f"env HSA_OVERRIDE_GFX_VERSION={os.environ.get('HSA_OVERRIDE_GFX_VERSION')}")
    for k in ("MIOPEN_FIND_MODE", "MIOPEN_DEBUG_DISABLE_FIND_DB", "PYTORCH_NO_CUDA_MEMORY_CACHING"):
        v = os.environ.get(k)
        if v:
            print(f"env {k}={v}")

    with step("import torch"):
        import torch

    print(f"torch: {torch.__version__}  hip={torch.version.hip}")
    print(f"cudnn.enabled at start: {torch.backends.cudnn.enabled}")

    device = torch.device("cuda")

    # Warm up the GPU with a basic gemm so first-kernel compile latency on
    # gemm doesn't contaminate the LSTM timing.
    with step("warm-up gemm"):
        a = torch.randn(256, 256, device=device)
        (a @ a).sum().item()
        torch.cuda.synchronize()

    # Pyannote-3.1 segmentation uses a 4-layer bidirectional LSTM with hidden
    # 128, input 60 (sincnet out) — reproduce exactly that shape.
    with step("construct LSTM on CPU"):
        lstm = torch.nn.LSTM(
            input_size=60, hidden_size=128, num_layers=4, bidirectional=True, batch_first=True,
        )
        n_params = sum(p.numel() for p in lstm.parameters())
        print(f"        LSTM params: {n_params:,}")

    # The suspect: moving the LSTM parameters to GPU.
    with step("lstm.to('cuda')", watchdog_seconds=60):
        lstm = lstm.to(device)

    with step("forward pass on GPU"):
        x = torch.randn(1, 500, 60, device=device)
        y, _ = lstm(x)
        y.sum().item()
        torch.cuda.synchronize()
        print(f"        LSTM output: {tuple(y.shape)}")

    print("\nDONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
