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
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Copy application code.
COPY --from=builder /build/alunotes_ai ./alunotes_ai

USER alunotes

EXPOSE 8100

ENTRYPOINT ["python", "-m", "uvicorn"]
CMD ["alunotes_ai.app:app", "--host", "0.0.0.0", "--port", "8100"]
