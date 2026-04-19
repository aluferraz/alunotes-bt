# ── Stage 1: Build dependencies ────────────────────────────────
FROM python:3.11-slim-bookworm AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential libsndfile1-dev libsox-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Install deps into a virtualenv so we can copy just that folder.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

# Copy app code (installed as editable in builder, but we'll just copy the
# package to the runtime stage).
COPY alunotes_ai/ alunotes_ai/

# ── Stage 1.5: Pre-download model weights ──────────────────────
# Runs with network access during `docker build`, fetches every HF repo the
# runtime needs into a standalone cache, and is discarded afterwards — so
# HF_TOKEN never lives in the final image, and the runtime container is fully
# offline-capable.
FROM builder AS model-downloader

ENV HF_HOME=/cache/huggingface

COPY scripts/download_models.py scripts/download_models.py
# HF_TOKEN is supplied via a BuildKit secret mount, so it never enters the
# image filesystem, layer history, or build cache metadata. Requires
# `DOCKER_BUILDKIT=1` (default in modern Docker) and Compose ≥ 2.23.
RUN --mount=type=secret,id=hf_token,required=true \
    HF_TOKEN="$(cat /run/secrets/hf_token)" python scripts/download_models.py

# ── Stage 2: Runtime ───────────────────────────────────────────
FROM python:3.11-slim-bookworm AS runtime

# Minimal runtime libraries only.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 libsox3 sox curl && \
    rm -rf /var/lib/apt/lists/* && \
    # Create non-root user and writable config dirs for matplotlib/fontconfig.
    groupadd -r alunotes && useradd -r -g alunotes -d /app alunotes && \
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
