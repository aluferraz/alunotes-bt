# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## What This Is

AluNotes Bridge — a transparent Bluetooth audio proxy for Raspberry Pi 5. Bridges A2DP music and HFP phone calls between a phone and headphones using dual Bluetooth adapters (onboard + USB dongle). All audio is recorded as WAV for LLM transcription. The Go daemon is a control plane only — PipeWire routes audio natively at full codec quality.

## Build & Dev Commands

```bash
# Bridge
make setup-permissions  # One-time: install D-Bus policy for non-root BlueZ access
make build              # Build for host platform (sets BT capabilities via setcap)
make build-pi           # Cross-compile for RPi 5 (GOOS=linux GOARCH=arm64)
make run                # Build and run
make run-all            # Build and run bridge + web app + AI server (all with color prefixes)
make test               # go test ./...
make lint               # golangci-lint run ./...
make clean              # Remove bin/

# AI (alunotes-ai)
make ai-install         # Install Python deps, system packages, ollama
make ai-configure       # Auto-detect hardware, write optimal ollama config
make ai-start           # Start ollama serve (systemd or foreground)
make ai-pull            # Pull required ollama models
make ai-test            # Run AI test suite (inference, ASR, diarization)
make ai-lint            # ruff + mypy
make ai-serve           # Start FastAPI dev server on :8100
make ai-dev             # Install dev deps
```

Binary: `bin/alunotes-bridge -config config.yaml`

### First-time setup

```bash
make deps               # Install ALL system deps (bridge + AI + ollama)
make setup-permissions   # D-Bus policy for non-root BlueZ access
make ai-configure        # Auto-tune ollama for this hardware
make ai-pull             # Download LLM models
```

Run `make setup-permissions` once to install the D-Bus policy (`deploy/dbus-alunotes.conf`) that allows non-root access to BlueZ. The build step uses `sudo setcap` to grant `cap_net_raw,cap_net_admin` to the binary — `sudo` is only needed for that, the bridge itself runs unprivileged.

## Dependencies

- Go 1.24+, BlueZ 5.x, libdbus-1-dev, pulseaudio-utils (pactl), PipeWire with Bluetooth (pipewire-pulse, libspa-0.2-bluetooth)
- Go modules: `github.com/godbus/dbus/v5` (D-Bus IPC), `gopkg.in/yaml.v3` (config)
- PipeWire CLI tools: `pw-link`, `pw-cat`, `pw-cli`, `pactl` (all used by the Go daemon for audio routing and recording)
- Python 3.11+, ollama, ffmpeg, libsndfile1, sox (for AI subpackage)
- No test framework beyond stdlib; `scripts/test-hfp.sh` validates the HFP pipeline using PipeWire null-sinks

## Architecture

The Go daemon is a **control plane only** — it manages BlueZ D-Bus connections, PipeWire routing commands (`pw-link`, `pactl`), and recording lifecycle. Audio data never flows through Go code; PipeWire routes it natively between Bluetooth adapters at full codec quality.

### A2DP music pipeline

Started dynamically when a BlueZ `MediaTransport1` D-Bus signal fires (phone connected):

- `AVRCPSync` (`internal/bt/mediasync.go`) — bidirectional volume sync via `MediaTransport1.Volume` D-Bus properties + MPRIS player on session bus for media control forwarding (Play/Pause/Next/Previous)
- `PipeWireCapture` (`internal/audio/pwcapture.go`) — runs `pw-cat --record` targeting the phone's PipeWire node, writes WAV to session directory
- PipeWire/WirePlumber handles actual audio routing between phone and headphone nodes

### HFP call pipeline

Runs on the **main context** (not the A2DP pipeline context) so it survives A2DP transport teardowns during profile switches:

- `HFPRouter` (`internal/pw/hfp.go`) — monitors `pactl subscribe` for PipeWire events, checks the phone's card active profile via `pactl list cards`. When profile is `headset-head-unit*`, a call is active. Detection uses the card profile (not MONO port presence) because BlueZ keeps idle HFP nodes alongside A2DP even without a call.
- On call start: switches headphone to HFP (`pactl set-card-profile`, tries mSBC then CVSD), links SCO audio bidirectionally via `pw-link`, creates a PipeWire null-sink mixer, links both call directions into it, records from the mixer's monitor via `pw-cat` (16kHz mono WAV with both sides mixed)
- On call end: cancels recording, unloads mixer module, restores headphone to A2DP
- `HFPCallControl` (`internal/bt/hfp.go`) — persistent MPRIS player on session bus (`org.mpris.MediaPlayer2.alunotes_call`) that forwards headphone AVRCP button presses as call controls during active calls

### Bluetooth layer

`internal/bt/` uses BlueZ via D-Bus (`godbus/dbus`). `Adapter` manages dual HCI adapters — sink adapter (hci0) is discoverable, source adapter (hci1) only makes outbound connections. Transport acquisition/release is event-driven via D-Bus signal matching. `Agent` auto-accepts pairing (Just Works).

### Session management

`internal/session/` tracks recording sessions. A session starts on first `Touch()`, ends after configurable silence timeout. Music recordings: 44.1kHz stereo. Call recordings: 16kHz mono (both sides mixed, optimized for LLM transcription).

### Legacy pipeline stages (unused, replaced by PipeWire)

The original pipeline (`capture.go`, `route.go`, `forward.go`, `writer.go`) read/wrote BlueZ transport FDs directly. Now unused — PipeWire handles all codec negotiation and audio routing natively.

## Key Design Decisions

- Dual-adapter mode is the primary use case; single-adapter is a fallback (record-only, no forwarding)
- Go daemon is control plane only — audio never passes through Go code, preserving full codec quality
- HFP detection uses phone's card profile (not MONO port detection) to avoid false positives from idle HFP nodes
- HFP router runs on main context, not pipeline context, to survive A2DP↔HFP transitions
- Full-duplex call recording via PipeWire null-sink mixer (both directions summed into single WAV)
- Config uses `EffectiveSourceAdapter()` to resolve single vs dual adapter mode
- Runs unprivileged with Linux capabilities (`cap_net_raw,cap_net_admin`) + D-Bus policy — no root required
- HTTP API server on `:8090` (configurable via `-api-addr` flag) serves bridge status, device connect/disconnect, and config endpoints for the web control plane

## AI Subpackage (`alunotes-ai/`)

Local LLM inference and media-processing APIs. All processing runs offline — zero telemetry, no third-party data egress. Served as a FastAPI app on `:8100`.

### Stack

- **Framework**: FastAPI + uvicorn
- **LLM inference**: Ollama (OpenAI-compatible proxy at `/v1/chat/completions`, `/v1/models`)
- **ASR**: Qwen3-ASR-1.7B via `qwen_asr` toolkit (transformers backend)
- **Diarization**: pyannote.audio 3.x + Qwen3-ASR two-step pipeline
- **Config**: pydantic-settings, env prefix `ALUNOTES_AI_`
- **Model**: `huihui_ai/gemma-4-abliterated:e2b` (ollama), `Qwen/Qwen3-ASR-1.7B` + `Qwen/Qwen3-ForcedAligner-0.6B` (HuggingFace, cached locally)

### Architecture

- `alunotes_ai/inference/router.py` — Ollama ↔ OpenAI API translation layer (proxies to `127.0.0.1:11434`)
- `alunotes_ai/asr/engine.py` — Wraps `Qwen3ASRModel`. Callers use `transcribe(audio) -> AsyncIterator[str]`, never touch the toolkit. Lazy model loading, forced aligner loaded separately on demand to avoid OOM on 16GB devices.
- `alunotes_ai/asr/router.py` — `/v1/asr/transcribe` endpoint (multipart audio upload + SSE streaming)
- `alunotes_ai/diarization/engine.py` — Two-step pipeline: ASR with timestamps → pyannote speaker segments → merge by timestamp overlap
- `alunotes_ai/diarization/router.py` — `/v1/asr/diarize` endpoint (multipart + NDJSON streaming)
- `alunotes_ai/config.py` — All settings via env vars (`ALUNOTES_AI_OLLAMA_MODEL`, `ALUNOTES_AI_ASR_DEVICE`, etc.)
- `scripts/ollama_autoconfig.sh` — Detects RAM/CPU/GPU, writes `~/.ollama/config` + `.env`

### Key Design Decisions

- All HuggingFace telemetry disabled via env vars (`TRANSFORMERS_OFFLINE=1`, `HF_HUB_DISABLE_TELEMETRY=1`, `HF_DATASETS_OFFLINE=1`) set before any transformers import
- Ollama telemetry disabled (`OLLAMA_NOTELEMETRY=1`) in config, `.env`, and Makefile
- ASR model and forced aligner are loaded separately (not simultaneously) to stay within 16GB RAM budget
- Tests run in separate pytest processes per module (inference → ASR → diarization) to free RAM between suites
- Ollama model name comes from config/env, never hardcoded in inference logic
- Thinking models handled: router falls back to `thinking` field when `content` is empty

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | OpenAI-compatible chat (proxied to ollama) |
| `/v1/models` | GET | List available ollama models |
| `/v1/asr/transcribe` | POST | Transcribe audio (multipart upload, SSE response) |
| `/v1/asr/diarize` | POST | Transcribe + speaker diarization (multipart, NDJSON) |

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
