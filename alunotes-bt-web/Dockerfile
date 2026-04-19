# ── Stage 1: Dependencies ──────────────────────────────────────
FROM node:22-slim AS deps

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ─────────────────────────────────────────────
FROM node:22-slim AS builder

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client.
RUN pnpm exec prisma generate

# Build with env validation skipped (runtime env injected at deploy time).
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Pre-initialize the sqlite DB with the schema applied, in a dir owned by the
# distroless nonroot uid (65532). Copied into the runtime image below so the
# `web-db` named volume inherits both the tables and writable ownership on
# first mount. (No migrations/ dir → `prisma db push`.)
RUN mkdir -p /empty-data \
    && DATABASE_URL="file:/empty-data/db.sqlite" pnpm exec prisma db push --skip-generate --accept-data-loss \
    && chown -R 65532:65532 /empty-data

# ── Stage 3: Runtime ───────────────────────────────────────────
FROM gcr.io/distroless/nodejs22-debian12:nonroot

WORKDIR /app

# Next.js standalone output contains everything needed to run.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma needs the generated client and the schema at runtime for SQLite.
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma

# Writable data dir for the sqlite file (persisted via named volume). Must be
# owned by the image's nonroot user (65532) so the named volume inherits
# writable permissions on first mount. DATABASE_URL in compose points here.
# --chown is required on the dir itself: without it, COPY --from creates the
# destination dir as root even when source files are 65532, and SQLite then
# hits SQLITE_READONLY_DIRECTORY trying to create -journal/-wal siblings.
COPY --from=builder --chown=65532:65532 /empty-data /app/data

EXPOSE 3000

CMD ["server.js"]
