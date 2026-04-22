"""Profile pyannote pipeline.to('cuda') to find the slow tensor/submodule.

Wraps torch.Tensor.to so every CPU→GPU copy prints its shape, dtype, and
duration. Also walks the pipeline submodule tree before the move to show
the inventory, and again per-submodule with timing so we can spot which
submodule eats the wall clock.

Invoke from alunotes-ai/:
    distrobox enter ubuntu24 -- env HSA_OVERRIDE_GFX_VERSION=10.3.0 \
        HIP_LAUNCH_BLOCKING=1 MIOPEN_FIND_MODE=5 \
        .venv/bin/python scripts/test_rocm_profile.py
"""

from __future__ import annotations

import faulthandler
import os
import sys
import time

faulthandler.enable()

print(f"env HSA_OVERRIDE_GFX_VERSION={os.environ.get('HSA_OVERRIDE_GFX_VERSION')}", flush=True)
print(f"env HIP_LAUNCH_BLOCKING={os.environ.get('HIP_LAUNCH_BLOCKING')}", flush=True)
print(f"env MIOPEN_FIND_MODE={os.environ.get('MIOPEN_FIND_MODE')}", flush=True)

import torch

print(f"torch {torch.__version__}  hip={torch.version.hip}", flush=True)

# ── Patch Tensor.to to log slow CPU→GPU copies ───────────────
_orig_to = torch.Tensor.to
_SLOW_MS = 100  # only report copies slower than 100ms

def _verbose_to(self, *args, **kwargs):
    target_device = None
    for a in args:
        if isinstance(a, (torch.device, str)):
            target_device = torch.device(a) if isinstance(a, str) else a
            break
    target_device = target_device or kwargs.get("device")
    is_cpu_to_cuda = (
        target_device is not None
        and target_device.type == "cuda"
        and self.device.type == "cpu"
    )
    t0 = time.monotonic()
    r = _orig_to(self, *args, **kwargs)
    # HIP_LAUNCH_BLOCKING=1 makes ops synchronous, so the return time already
    # reflects real work. Still add a sync for belt-and-braces.
    if is_cpu_to_cuda:
        torch.cuda.synchronize()
    dt_ms = (time.monotonic() - t0) * 1000
    if is_cpu_to_cuda and dt_ms >= _SLOW_MS:
        print(
            f"  slow-to: {dt_ms:7.1f}ms  shape={tuple(self.shape)}  dtype={self.dtype}  numel={self.numel():,}",
            flush=True,
        )
    return r

torch.Tensor.to = _verbose_to


def step(label: str):
    def _inner(fn):
        def _call(*args, **kwargs):
            print(f"\n[step] {label} ...", flush=True)
            t0 = time.monotonic()
            r = fn(*args, **kwargs)
            print(f"[step] {label} -> {time.monotonic()-t0:.2f}s", flush=True)
            return r
        return _call
    return _inner


@step("warm-up gemm")
def warmup():
    a = torch.randn(256, 256, device="cuda")
    (a @ a).sum().item()
    torch.cuda.synchronize()


@step("import pyannote.audio")
def imp():
    from pyannote.audio import Pipeline as P
    return P


@step("load pyannote pipeline on CPU")
def load(P):
    return P.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=os.environ.get("HF_TOKEN"),
    )


def walk_pipeline(pipeline):
    """Enumerate what's inside the pipeline before we try to move it.
    pyannote stores the Inference objects under underscore-prefixed attrs
    (e.g. `_segmentation`, `_embedding`) so `dir()` alone skips them — walk
    `vars(pipeline)` which shows the actual instance dict."""
    print("\n=== Pipeline __dict__ contents ===", flush=True)
    for name, val in vars(pipeline).items():
        cls = val.__class__.__name__
        model = getattr(val, "model", None) if not isinstance(val, torch.nn.Module) else val
        if isinstance(model, torch.nn.Module):
            n = sum(p.numel() for p in model.parameters())
            print(f"  pipeline.{name:30s} [{cls}]  params: {n:,}", flush=True)
        else:
            print(f"  pipeline.{name:30s} [{cls}]", flush=True)


def move_pipeline_with_logging(pipeline, device):
    """Just pipeline.to(device) — but the global Tensor.to hook above will
    print every slow CPU→GPU tensor copy as it happens, so we learn which
    tensor is eating the wall clock without needing to know pyannote's
    internal structure."""
    print(f"\n=== pipeline.to({device}) with per-tensor logging ===", flush=True)
    t0 = time.monotonic()
    pipeline.to(device)
    print(f"=== pipeline.to done in {time.monotonic()-t0:.2f}s ===", flush=True)


def main() -> int:
    warmup()
    P = imp()
    pipeline = load(P)

    walk_pipeline(pipeline)

    # Use a 30-min watchdog so the whole block gets a chance — this test is
    # diagnostic, we want data more than a fast fail.
    faulthandler.dump_traceback_later(1800, exit=False)
    try:
        move_pipeline_with_logging(pipeline, torch.device("cuda"))
    finally:
        faulthandler.cancel_dump_traceback_later()

    print("\nDONE", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
