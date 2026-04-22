#!/usr/bin/env bash
# Detect the PyTorch GPU backend usable on this host.
#
# Prints one of: rocm | cuda | cpu  (on stdout, nothing else).
#
# Order:
#   1. $AI_GPU_BACKEND override (rocm|cuda|cpu) — bypass detection entirely.
#   2. nvidia-smi succeeds  → cuda
#   3. /dev/kfd present     → rocm   (AMD amdgpu compute device)
#   4. lspci sees AMD/Radeon display adapter → rocm (fresh distrobox where
#      /dev/kfd isn't yet exposed to the guest but will be once the image is
#      re-entered — still lets us install the right wheel up front)
#   5. otherwise            → cpu
#
# Designed to run both on the host (SteamOS) and inside the distrobox. If
# lspci isn't installed, the AMD fallback is skipped silently.
set -euo pipefail

if [ -n "${AI_GPU_BACKEND:-}" ]; then
    echo "$AI_GPU_BACKEND"
    exit 0
fi

if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    echo cuda
    exit 0
fi

if [ -e /dev/kfd ]; then
    echo rocm
    exit 0
fi

if command -v lspci >/dev/null 2>&1 && \
   lspci -nn 2>/dev/null | grep -iE 'vga|3d|display' | grep -qiE 'amd|ati|radeon'; then
    echo rocm
    exit 0
fi

echo cpu
