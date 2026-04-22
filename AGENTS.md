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

## Debugging hard problems — don't quit on round one

Real example: GPU diarization on the RDNA2 APU appeared broken ("hangs for
20+ minutes"). The first instinct was to drop back to CPU and move on. That
would have been wrong. The actual fix was three separate discoveries stacked:

1. `HSA_ENABLE_SDMA=0` — the SDMA engine mis-handles host↔device copies on
   spoofed integrated GPUs (every first-time tensor shape stalls in
   `libhsa-runtime64.so`). Fixed `pipeline.to(cuda)` from 20 min → 0.99 s.
2. `GPU_MAX_HW_QUEUES=1` + `AMD_SERIALIZE_KERNEL=3` — serialize launches to
   avoid allocator races in the SDMA=0 path.
3. `apt install librocrand-dev rocm-device-libs-17` — the torch-rocm pip
   wheel ships `libMIOpen.so` + `librocrand.so` but not their headers, so
   MIOpen's first-forward-pass JIT fails with `rocrand_xorwow.h file not
   found`. A runtime apt install provides the headers.

End result: GPU diarization warm path is **6× faster than CPU** with
identical output — after the bug looked terminal on the surface.

Rules this drills in:

- When the user says "we are not giving up," respect it. Performance
  workarounds exist — they're just buried in GitHub issues, community
  tutorials, and vendor forums. Search them out before proposing a fallback.
- Instrument before you theorize. Don't guess which stage is slow — write a
  step-by-step test with per-step timing and a `faulthandler` watchdog
  (`alunotes-ai/scripts/test_rocm_diarization.py` is the template). A native
  `py-spy dump --native` often beats five hypotheses.
- Treat "stuck" as a hypothesis, not a conclusion. 20 min of no output could
  be a hang — or it could be first-ever MIOpen JIT compiling dozens of
  kernels. Measure what's actually happening before declaring failure.
- Fixes compose. A single workaround rarely solves a multi-layer bug; expect
  to stack 2-4 orthogonal changes (env vars + packages + config).
- The torch-rocm pip wheel is self-contained for *runtime*, not for *JIT*.
  When MIOpen JIT-compiles a kernel (first-pass dropout, first-pass RNN,
  etc.) it needs ROCm dev headers that the wheel doesn't ship — supply them
  via system apt.

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

- `alunotes_ai/app.py` — FastAPI app factory with lifespan management (starts/stops job queue when enabled)
- `alunotes_ai/config.py` — All settings via env vars (`ALUNOTES_AI_` prefix). Includes feature flags and job TTL configuration.
- `alunotes_ai/memory.py` — Slot-based model memory manager. Only one of {ollama, asr, diarization} occupies RAM at a time. Used internally by the job queue worker.
- `alunotes_ai/queue.py` — SQLite-backed in-memory job queue. Processes jobs FIFO, batches same-type jobs to minimize model swaps. Heartbeat + reaper for stale jobs. Background monitor logs queue depth, RSS, CPU %.
- `alunotes_ai/inference/router.py` — Ollama ↔ OpenAI API translation layer (proxies to `127.0.0.1:11434`)
- `alunotes_ai/asr/engine.py` — Wraps `Qwen3ASRModel`. Callers use `transcribe(audio) -> AsyncIterator[str]`, never touch the toolkit. Lazy model loading, forced aligner loaded separately on demand. Integrates resampling and VAD chunking.
- `alunotes_ai/asr/router.py` — `/v1/asr/transcribe` endpoint (multipart audio upload + SSE streaming). Supports `format=srt` query param for SRT subtitle output. Applies hallucination filter when enabled.
- `alunotes_ai/asr/resample.py` — Auto-resamples audio to 16kHz mono float32 (torchaudio with ffmpeg fallback). Gated by `use_resampling`.
- `alunotes_ai/asr/filters.py` — Post-transcription hallucination filter. Detects and collapses repeated n-grams (5/4/3-word). Gated by `use_hallucination_filter`.
- `alunotes_ai/asr/vad.py` — Silero VAD chunking for audio > 3 minutes. Splits on silence boundaries to prevent OOM on Pi.
- `alunotes_ai/asr/srt.py` — SRT subtitle format generator from timestamped ASR segments.
- `alunotes_ai/diarization/engine.py` — Two-step pipeline: pyannote speaker diarization → per-segment ASR transcription
- `alunotes_ai/diarization/router.py` — `/v1/asr/diarize` endpoint (multipart + SSE streaming). Returns 501 when `use_diarization` is disabled.
- `scripts/ollama_autoconfig.sh` — Detects RAM/CPU/GPU, writes `~/.ollama/config` + `.env` (plain `KEY=VALUE` format)

### Feature Flags

All configurable via env vars with `ALUNOTES_AI_` prefix:

| Variable | Type | Default | Purpose |
|---|---|---|---|
| `USE_QUEUE` | bool | true | Enable SQLite job queue (false = legacy direct MemoryManager) |
| `USE_FORCED_ALIGNER` | bool | true | Load Qwen3-ForcedAligner for timestamps/SRT |
| `USE_DIARIZATION` | bool | true | Enable `/v1/asr/diarize` endpoint |
| `USE_HALLUCINATION_FILTER` | bool | true | Post-process ASR to remove repeated n-grams |
| `USE_RESAMPLING` | bool | true | Auto-resample audio to 16kHz mono |
| `ASR_JOB_TTL` | int | 300 | TTL for ASR queue jobs (seconds) |
| `DIARIZE_JOB_TTL` | int | 600 | TTL for diarization jobs |
| `LLM_JOB_TTL` | int | 300 | TTL for LLM jobs |
| `QUEUE_MONITOR_INTERVAL` | int | 30 | Seconds between queue status log lines |

### Key Design Decisions

- All HuggingFace telemetry disabled via env vars (`TRANSFORMERS_OFFLINE=1`, `HF_HUB_DISABLE_TELEMETRY=1`, `HF_DATASETS_OFFLINE=1`) set before any transformers import
- Ollama telemetry disabled (`OLLAMA_NOTELEMETRY=1`) in config, `.env`, and Makefile
- ASR model and forced aligner are loaded separately (not simultaneously) to stay within 16GB RAM budget
- Tests run in separate pytest processes per module (inference → ASR → diarization) to free RAM between suites
- Ollama model name comes from config/env, never hardcoded in inference logic
- Thinking models handled: router falls back to `thinking` field when `content` is empty
- Job queue uses in-memory SQLite with thread-safe locking — no external dependencies (Redis, etc.)
- Same-type job batching minimizes model swap overhead (e.g. run all pending ASR jobs before switching to ollama)
- Heartbeat + reaper prevents stuck jobs from blocking the queue
- `.env` uses plain `KEY=VALUE` format (no `export` prefix); Makefile loads via `-include .env` + `export`
- Audio resampling uses torchaudio with ffmpeg subprocess fallback for environments without torchaudio
- VAD chunking only activates for audio > 3 minutes to avoid unnecessary overhead on short clips

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | OpenAI-compatible chat (proxied to ollama) |
| `/v1/models` | GET | List available ollama models |
| `/v1/asr/transcribe` | POST | Transcribe audio (multipart upload, SSE response). Optional `format=srt` for SRT subtitles. |
| `/v1/asr/diarize` | POST | Transcribe + speaker diarization (multipart, SSE). Returns 501 if disabled. |

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
