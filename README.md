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

## Prerequisites

- Raspberry Pi 5 (or any Linux system with Bluetooth)
- Go 1.24+
- Node.js 20+ and pnpm
- BlueZ 5.x (Bluetooth stack)
- PipeWire with Bluetooth support (`pipewire-pulse`, `libspa-0.2-bluetooth`)
- Two Bluetooth adapters (onboard + USB dongle)

## Setup

### 1. Install dependencies

```bash
make deps
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
# Bridge + web app together (with hot-reload)
make run-all

# Or just the bridge
make run
```

The web control plane is at `http://localhost:3000`. The Go API runs on `http://localhost:8090`.

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

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/status` | Bridge status, connected devices, active session |
| `GET /api/v1/bluetooth/devices` | Connected devices list |
| `POST /api/v1/bluetooth/connect` | Connect to device by MAC |
| `POST /api/v1/bluetooth/disconnect` | Disconnect device |
| `GET /api/v1/bluetooth/scan` | Discover nearby devices |
| `GET /api/v1/config` | Current configuration |
| `GET /health` | Health check |

## Makefile targets

| Target | Description |
|---|---|
| `make deps` | Install system dependencies (BlueZ, libdbus, libsbc, pactl) |
| `make setup-permissions` | Install D-Bus policy for non-root BlueZ access |
| `make build` | Build for host platform and set BT capabilities |
| `make build-pi` | Cross-compile for RPi 5 (ARM64) |
| `make run` | Build and run the bridge |
| `make run-all` | Build and run bridge (watch mode) + web app |
| `make lint` | Run golangci-lint |
| `make test` | Run tests |
| `make clean` | Remove build artifacts |

## License

MIT
