# ── Stage 1: Build dependencies ────────────────────────────────
FROM python:3.11-slim-bookworm AS builder

# GPU backend for the torch wheel: cpu | rocm | cuda. Must be a *build* arg,
# not a runtime env var — the Docker builder doesn't see the host GPU, so
# detection has to happen on the caller's side (Makefile / compose passes
# this in via --build-arg). Default is `cpu` so `docker build` keeps working
# on CI without GPUs.
ARG AI_GPU_BACKEND=cpu
# Keep rocm-index in lockstep with alunotes-ai/Makefile (rocm6.4 → torch 2.9.x).
# pyannote-audio 4.x requires torch>=2.8, which older ROCm indices don't ship.
ARG TORCH_ROCM_INDEX=https://download.pytorch.org/whl/rocm6.4
ARG TORCH_CPU_INDEX=https://download.pytorch.org/whl/cpu

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential libsndfile1-dev libsox-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Install deps into a virtualenv so we can copy just that folder.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml ./
# Install torch FIRST for the requested backend, so `pip install .` (which
# pulls torch transitively via qwen-asr / pyannote) sees it already resolved
# and doesn't replace it with the default CUDA wheel from PyPI.
RUN pip install --no-cache-dir --upgrade pip && \
    case "$AI_GPU_BACKEND" in \
        rocm) pip install --no-cache-dir torch torchaudio --index-url "$TORCH_ROCM_INDEX" ;; \
        cuda) pip install --no-cache-dir torch torchaudio ;; \
        cpu)  pip install --no-cache-dir torch torchaudio --index-url "$TORCH_CPU_INDEX" ;; \
        *) echo "unknown AI_GPU_BACKEND: $AI_GPU_BACKEND" >&2; exit 1 ;; \
    esac && \
    pip install --no-cache-dir .

# Copy app code (installed as editable in builder, but we'll just copy the
# package to the runtime stage).
COPY alunotes_ai/ alunotes_ai/

# ── Stage 1.5: Pre-download model weights ──────────────────────
# Runs with network access during `docker build`, fetches every HF repo the
# runtime needs into a standalone cache, and is discarded afterwards — so
# HF_TOKEN never lives in the final image, and the runtime container is fully
# offline-capable.
#
# Deliberately based on python:slim (not `builder`) so app-code / pyproject
# changes don't invalidate the download layer. Combined with the cache mount
# below, re-downloads only happen when the repo list itself changes.
FROM python:3.11-slim-bookworm AS model-downloader

RUN pip install --no-cache-dir huggingface_hub

WORKDIR /build
COPY scripts/download_models.py scripts/download_models.py

# HF_TOKEN is supplied via a BuildKit secret mount, so it never enters the
# image filesystem, layer history, or build cache metadata. Requires
# `DOCKER_BUILDKIT=1` (default in modern Docker) and Compose ≥ 2.23.
#
# The `type=cache` mount persists HF blobs across builds independently of the
# layer cache — so even when the layer invalidates, huggingface_hub's
# content-addressed files get reused and re-downloads become cheap verifies.
# Cache mounts aren't part of the image, so we copy to /cache at the end of
# the RUN so the next stage can COPY --from it.
RUN --mount=type=secret,id=hf_token,required=true \
    --mount=type=cache,target=/hf-cache,id=hf-models,uid=0,gid=0 \
    HF_HOME=/hf-cache HF_TOKEN="$(cat /run/secrets/hf_token)" \
        python scripts/download_models.py && \
    mkdir -p /cache && cp -a /hf-cache/. /cache/huggingface/

# ── Stage 2: Runtime ───────────────────────────────────────────
FROM python:3.11-slim-bookworm AS runtime

# Minimal runtime libraries only.
#   libnuma1 / libdrm2 are runtime deps of the torch-rocm wheel when the image
#     was built with AI_GPU_BACKEND=rocm. Installing them unconditionally keeps
#     the runtime stage identical across backends (~200 KB total, harmless on
#     CPU/CUDA images) so the multi-arch builds stay reproducible.
#   librocrand-dev / rocm-device-libs-17 supply the headers + device bitcode
#     MIOpen's JIT compiler needs on first forward pass. The pip torch-rocm
#     wheel ships libMIOpen.so + librocrand.so but not their dev headers, so
#     without these the first GPU inference fails with rocrand_xorwow.h not
#     found. Small footprint (~30 MB); installing unconditionally preserves
#     the multi-arch single-Dockerfile invariant.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 libsox3 sox curl \
        libnuma1 libdrm2 \
        librocrand-dev rocm-device-libs-17 && \
    rm -rf /var/lib/apt/lists/* && \
    # Ensure the `video` / `render` groups exist with GIDs commonly used on
    # Debian/Ubuntu hosts (video=44, render=109). Compose mounts /dev/kfd
    # and /dev/dri/* from the host into the container; the alunotes user
    # needs group membership to open them. If the host's render GID differs
    # (SteamOS etc.) override it via `group_add: ["<gid>"]` in
    # docker-compose.gpu.yml — numeric GIDs don't need a matching group name.
    groupadd -g 44 -f video && groupadd -g 109 -f render && \
    groupadd -r alunotes && \
    useradd -r -g alunotes -G video,render -d /app alunotes && \
    mkdir -p /app/.config /app/.cache && chown -R alunotes:alunotes /app

WORKDIR /app

# Copy virtualenv from builder.
COPY --from=builder /opt/venv /opt/venv

# Bake the pre-downloaded HF cache in — the runtime never talks to huggingface.co.
COPY --from=model-downloader --chown=alunotes:alunotes /cache/huggingface /app/.cache/huggingface

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/app/.cache/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_DATASETS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1

# Copy application code.
COPY --from=builder /build/alunotes_ai ./alunotes_ai

USER alunotes

EXPOSE 8100

ENTRYPOINT ["python", "-m", "uvicorn"]
CMD ["alunotes_ai.app:app", "--host", "0.0.0.0", "--port", "8100"]
