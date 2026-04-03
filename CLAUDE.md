# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

AluNotes Bridge — a Bluetooth A2DP audio proxy for Raspberry Pi 5. It appears as a Bluetooth headphone (A2DP sink) to phones, forwards audio to real headphones (A2DP source), and saves recordings as WAV files. Requires dual Bluetooth adapters (onboard + USB dongle) since one radio can't handle sink + source simultaneously.

## Build & Dev Commands

```bash
make build          # Build for host platform (runs go mod tidy first)
make build-pi       # Cross-compile for RPi 5 (GOOS=linux GOARCH=arm64)
make run            # Build and run with sudo (requires root for BlueZ)
make test           # go test ./...
make lint           # golangci-lint run ./...
make clean          # Remove bin/
```

Binary: `bin/alunotes-bridge -config config.yaml`

## Dependencies

- Go 1.24+, BlueZ 5.x, libdbus-1-dev
- Go modules: `github.com/godbus/dbus/v5` (D-Bus IPC), `gopkg.in/yaml.v3` (config)
- No test framework beyond stdlib

## Architecture

Four-stage concurrent audio pipeline, each stage a goroutine connected by Go channels:

1. **Capture** (`internal/audio/capture.go`) — reads PCM from BlueZ media transport FD
2. **Route** (`internal/audio/route.go`) — fans out to forward (blocking) and disk (best-effort, drops if slow)
3. **Forward** (`internal/audio/forward.go`) — writes PCM to outbound transport FD (real headphones)
4. **Write** (`internal/audio/writer.go`) — saves WAV via session manager

Pipeline is started dynamically when a BlueZ transport is acquired (D-Bus signal), not at startup. The `done` channel coordinates goroutine shutdown.

**Bluetooth layer** (`internal/bt/`) uses BlueZ via D-Bus (`godbus/dbus`). `Adapter` manages dual HCI adapters — sink adapter is discoverable, source adapter only makes outbound connections. `A2DPProfile` registers with BlueZ's ProfileManager. Transport acquisition/release is event-driven via D-Bus signal matching.

**Session management** (`internal/session/`) tracks recording sessions. A session starts on first audio buffer, ends after configurable silence timeout. WAV headers use placeholder sizes, finalized on session end. Silence detection uses peak PCM amplitude.

## Key Design Decisions

- Dual-adapter mode is the primary use case; single-adapter is a fallback (record-only, no forwarding)
- Forward channel uses blocking sends (latency-critical); disk channel drops buffers if writer falls behind
- Config uses `EffectiveSourceAdapter()` to resolve single vs dual adapter mode
- Requires root/BT capabilities — `make run` uses sudo
- HTTP API server on `:8090` (configurable via `-api-addr` flag) serves bridge status, device connect/disconnect, and config endpoints for the web control plane

## Web App (`alunotes-bt-web/`)

Control plane UI for the Bluetooth bridge, built with the T3 stack (oRPC variant).

### Stack

- **Framework**: Next.js 15 (App Router, React 19)
- **API**: oRPC (not tRPC) with TanStack Query
- **Auth**: Better Auth (Google OAuth + email/password)
- **ORM**: Prisma with SQLite
- **UI**: shadcn/ui + glass-ui (liquid-glass components), Tailwind CSS v4
- **Icons**: lucide-react

### Dev Commands

```bash
cd alunotes-bt-web
pnpm dev            # Start dev server (Turbopack)
pnpm build          # Production build
pnpm start          # Start production server
pnpm db:push        # Push schema to SQLite
pnpm db:studio      # Open Prisma Studio
pnpm db:generate    # Run Prisma migration
pnpm check          # Lint + typecheck
```

### Architecture

The web app runs on the same RPi 5 as the Go daemon. It reads the daemon's filesystem directly:

- **Recordings**: Go daemon saves WAV files to `public/recordings/` so Next.js serves them as static assets
- **Config**: Reads/writes `../config.yaml` (configurable via `BRIDGE_CONFIG_PATH` env var)
- **Bluetooth status/control**: oRPC server procedures call the Go daemon's HTTP API at `BRIDGE_API_URL` (default `http://localhost:8090`). Gracefully degrades if daemon is unreachable

oRPC routers: `bluetooth` (device status/control), `recordings` (filesystem + Prisma metadata), `settings` (YAML config), `profile` (user management).

Prisma models: `User`, `Session`, `Account`, `Verification` (Better Auth), `Device` (known BT devices), `RecordingMeta` (user annotations on recordings).
