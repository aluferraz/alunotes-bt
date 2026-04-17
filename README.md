# AluNotes Bridge

A transparent Bluetooth audio proxy for Raspberry Pi 5. Bridges audio between your phone and headphones — music streams at full codec quality, phone calls are detected and routed automatically, and all audio is recorded as WAV for LLM transcription.

## How it works

The Pi sits between your phone and headphones using two Bluetooth adapters:

```
Phone ──A2DP──► Pi (hci0)                Pi (hci1) ──A2DP──► Headphones
                     │     PipeWire          │
                     └──────routing───────────┘
                              │
                         WAV recording
                       (music + calls)
```

- **Music**: Streams at full codec quality (SBC/AAC/LDAC/aptX). The Go daemon never touches audio data — PipeWire routes it natively between adapters.
- **Phone calls**: Detected automatically when the phone's Bluetooth profile switches to HFP. The bridge switches the headphone to SCO mode, links bidirectional call audio, and records both sides (caller + user mic) mixed into a single WAV.
- **Controls**: Volume, play/pause/next/prev are synced bidirectionally between phone and headphone. During calls, headphone button presses are forwarded as answer/hangup.

## Features

| Feature | Status |
|---------|--------|
| A2DP music bridging (phone → headphone) | Working |
| Bidirectional volume sync | Working |
| Play/Pause/Next/Previous forwarding (AVRCP → MPRIS) | Working |
| WAV recording of music | Working |
| HFP call detection (card profile monitoring) | Working |
| Call audio routing (phone SCO ↔ headphone SCO) | Working |
| Full-duplex call recording (both sides mixed) | Working |
| Call control forwarding (answer/hangup via AVRCP) | Best-effort |
| Auto-pairing (Just Works agent) | Working |
| Web control plane (Next.js + Go HTTP API) | Working |
| Local LLM inference (OpenAI-compatible API) | Working |
| Speech-to-text (Qwen3-ASR) | Working |
| Speaker diarization (pyannote.audio) | Working |
| SRT subtitle output (forced aligner timestamps) | Working |
| Audio auto-resampling (16kHz mono) | Working |
| Hallucination filter (repeated n-gram collapse) | Working |
| VAD chunking for long audio (>3min) | Working |
| SQLite job queue (FIFO, same-type batching) | Working |

## Prerequisites

- Raspberry Pi 5 (or any Linux system with Bluetooth)
- Go 1.24+
- Python 3.11+
- Node.js 20+ and pnpm
- BlueZ 5.x (Bluetooth stack)
- PipeWire with Bluetooth support (`pipewire-pulse`, `libspa-0.2-bluetooth`)
- Two Bluetooth adapters (onboard + USB dongle)

## Setup

### 1. Install dependencies

```bash
make deps               # System packages + ollama
make ai-install          # Python venv + AI deps
make ai-configure        # Auto-tune ollama for your hardware
make ai-pull             # Download LLM models (~7GB)
```

### 2. Install D-Bus policy (one-time)

Allows the bridge to access BlueZ without running as root:

```bash
make setup-permissions
```

### 3. Configure

```bash
cp config.yaml.example config.yaml
```

Key settings:

| Setting | Default | Description |
|---|---|---|
| `bluetooth.sink_adapter` | `hci0` | HCI adapter receiving audio from phone |
| `bluetooth.source_adapter` | `hci1` | HCI adapter sending audio to headphones |
| `bluetooth.sink_name` | auto-generated | Name visible to phones |
| `bluetooth.target_headphone` | _(empty)_ | MAC of real headphone (e.g. `90:62:3F:95:23:5A`) |
| `session.idle_timeout` | `30s` | Silence duration before ending a recording session |
| `storage.base_dir` | `./alunotes-bt-web/public/recordings` | Where recordings are saved |

> **Note:** The Pi 5's onboard Bluetooth cannot handle A2DP sink + source simultaneously.
> You need a USB Bluetooth dongle as the second adapter.

### 4. Set up the web app

For details on the PWA control plane, UI stack, and frontend environment setup, please refer to the dedicated [Web App README](./alunotes-bt-web/README.md).

## Run

```bash
# Everything: bridge + web app + AI server (with hot-reload)
make run-all

# Or just the bridge
make run

# Or just the AI server
make ai-serve
```

The web control plane is at `http://localhost:3000`. The Go API runs on `http://localhost:8090`. The AI API runs on `http://localhost:8100`.

## Pairing

### Headphones (outbound via hci1)

```bash
bluetoothctl
> select /org/bluez/hci1
> scan on
> pair AA:BB:CC:DD:EE:FF
> trust AA:BB:CC:DD:EE:FF
```

Set the MAC in `config.yaml` under `bluetooth.target_headphone`.

### Phone (inbound via hci0)

Run the bridge, then connect to "AluNotes-XXXX" from your phone's Bluetooth settings. Pairing is auto-accepted.

## Recordings

Audio is saved as WAV organized by session:

```
recordings/
  2025-01-15/
    14-30-00/
      recording-abc123.wav       # Music (44.1kHz stereo)
      call-xyz789.wav            # Call (16kHz mono, both sides mixed)
```

Sessions start when audio begins and end after the idle timeout. Call recordings are 16kHz mono — optimized for LLM transcription.

## Project structure

```
cmd/bridge/                Main entrypoint, pipeline orchestration
internal/
  bt/
    adapter.go             BlueZ D-Bus adapter management, transport lifecycle
    mediasync.go           Volume sync + MPRIS media control forwarding
    hfp.go                 Call-aware MPRIS player for call control forwarding
    agent.go               BlueZ pairing agent (auto-accept)
    endpoint.go            A2DP MediaEndpoint1 (SBC codec negotiation)
    profile.go             BlueZ Profile1 lifecycle handler
  pw/
    hfp.go                 HFP call detection, SCO routing, full-duplex recording
    link.go                PipeWire port linking (pw-link)
    mediasync.go           PipeWire volume sync (pactl/wpctl)
  audio/
    pwcapture.go           PipeWire audio capture (pw-cat → WAV)
    writer.go              WAV file writer with session management
  session/                 Recording session lifecycle + idle timeout
  api/                     HTTP REST API for web control plane
  config/                  YAML configuration
  logging/                 Structured logging (console + rotated JSON)
scripts/
  test-hfp.sh             HFP pipeline test (no real call needed)
deploy/                    D-Bus policy, systemd service, install script
alunotes-bt-web/           Next.js web control plane
alunotes-ai/               Local AI inference + ASR + diarization
  alunotes_ai/
    app.py                 FastAPI app factory (lifespan starts/stops job queue)
    config.py              pydantic-settings (env-driven, feature flags)
    memory.py              Slot-based model memory manager (one model at a time)
    queue.py               SQLite job queue (FIFO, same-type batching, heartbeat/reaper)
    inference/router.py    Ollama → OpenAI API proxy
    asr/engine.py          Qwen3-ASR wrapper (lazy loading, resampling, VAD chunking)
    asr/router.py          /v1/asr/transcribe endpoint (SSE, SRT output support)
    asr/resample.py        Auto-resample to 16kHz mono (torchaudio / ffmpeg)
    asr/filters.py         Hallucination filter (repeated n-gram collapse)
    asr/vad.py             Silero VAD chunking for long audio (>3min)
    asr/srt.py             SRT subtitle format generator
    diarization/engine.py  pyannote + ASR two-step pipeline
    diarization/router.py  /v1/asr/diarize endpoint (501 when disabled)
  scripts/
    ollama_autoconfig.sh   Hardware detection + ollama config writer
  tests/                   pytest + httpx async integration tests
```

## Testing HFP

Validate the call pipeline without making real phone calls:

```bash
./scripts/test-hfp.sh          # All tests
./scripts/test-hfp.sh detect   # Mono port detection
./scripts/test-hfp.sh mixer    # Full-duplex recording pipeline
./scripts/test-hfp.sh profile  # Card profile switching (needs BT device)
./scripts/test-hfp.sh mpris    # MPRIS call control registration
```

## API

### Bridge (`:8090`)

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/status` | Bridge status, connected devices, active session |
| `GET /api/v1/bluetooth/devices` | Connected devices list |
| `POST /api/v1/bluetooth/connect` | Connect to device by MAC |
| `POST /api/v1/bluetooth/disconnect` | Disconnect device |
| `GET /api/v1/bluetooth/scan` | Discover nearby devices |
| `GET /api/v1/config` | Current configuration |
| `GET /health` | Health check |

### AI (`:8100`)

All inference runs locally — no data leaves the device. Features are individually toggleable via `ALUNOTES_AI_*` env vars.

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI-compatible chat completions (proxied to ollama) |
| `GET /v1/models` | List available models |
| `POST /v1/asr/transcribe` | Speech-to-text (multipart audio upload, SSE streaming). `?format=srt` for SRT subtitles. |
| `POST /v1/asr/diarize` | Transcribe + speaker diarization (multipart, SSE). Returns 501 if disabled. |

**Audio pipeline:** Input audio is auto-resampled to 16kHz mono. Files > 3 minutes are split on silence boundaries via Silero VAD. Transcripts are post-filtered for hallucination artifacts (repeated n-grams). All pipeline stages are feature-flagged.

**Job queue:** An in-memory SQLite job queue (enabled by default) processes inference jobs FIFO, batching same-type jobs to minimize model swaps. Includes heartbeat monitoring and automatic expiry of stale jobs.

## Makefile targets

| Target | Description |
|---|---|
| `make deps` | Install all system dependencies (bridge + AI + ollama) |
| `make setup-permissions` | Install D-Bus policy for non-root BlueZ access |
| `make build` | Build for host platform and set BT capabilities |
| `make build-pi` | Cross-compile for RPi 5 (ARM64) |
| `make run` | Build and run the bridge |
| `make run-all` | Build and run bridge + web app + AI server |
| `make lint` | Run golangci-lint |
| `make test` | Run Go tests |
| `make clean` | Remove build artifacts |
| `make ai-install` | Install AI Python deps + system packages + ollama |
| `make ai-configure` | Auto-detect hardware, write optimal ollama config |
| `make ai-start` | Start ollama serve |
| `make ai-pull` | Pull required LLM models |
| `make ai-test` | Run AI test suite (inference, ASR, diarization) |
| `make ai-lint` | ruff + mypy on AI code |
| `make ai-serve` | Start AI FastAPI dev server on :8100 |

## License

MIT
