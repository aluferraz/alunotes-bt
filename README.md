# AluNotes Bridge

A transparent Bluetooth A2DP audio proxy for Raspberry Pi 5. Appears as a Bluetooth headphone to your phone, forwards audio to real headphones, and saves recordings to disk. Includes a web control plane for managing devices, recordings, and settings.

## Prerequisites

- Raspberry Pi 5 (or any Linux system with Bluetooth)
- Go 1.24+
- Node.js 20+ and pnpm
- BlueZ 5.x (Bluetooth stack)
- D-Bus development headers
- inotify-tools (for watch mode)

### Install dependencies (Debian/Raspberry Pi OS)

```bash
sudo apt update
sudo apt install -y bluez bluez-tools libdbus-1-dev inotify-tools
```

Ensure the Bluetooth service is running:

```bash
sudo systemctl enable bluetooth
sudo systemctl start bluetooth
```

## Setup

### 1. Install D-Bus policy (one-time)

This allows the bridge to access BlueZ without running as root:

```bash
make setup-permissions
```

### 2. Configure

Copy the example config and edit it:

```bash
cp config.yaml.example config.yaml
```

Key settings:

| Setting | Default | Description |
|---|---|---|
| `bluetooth.sink_adapter` | `hci0` | HCI adapter for receiving audio (onboard) |
| `bluetooth.source_adapter` | `hci1` | HCI adapter for sending to headphones (USB dongle) |
| `bluetooth.sink_name` | `AluNotes Bridge` | Name visible to phones |
| `bluetooth.target_headphone` | _(empty)_ | MAC of real headphone (e.g. `AA:BB:CC:DD:EE:FF`) |
| `session.idle_timeout` | `30s` | Silence duration before ending a session |
| `storage.base_dir` | `./recordings` | Where recordings are saved |

> **Note:** The Pi 5's onboard Bluetooth cannot handle A2DP sink + source simultaneously.
> You need a USB Bluetooth dongle (e.g. ASUS USB-BT500) as the second adapter.
> The onboard adapter (`hci0`) receives audio; the USB dongle (`hci1`) forwards to headphones.

### 3. Set up the web app

```bash
cd alunotes-bt-web
cp .env.example .env    # Edit with your secrets
pnpm install
pnpm db:push            # Initialize SQLite database
```

## Run

```bash
# Run the bridge + web app together (with Go hot-reload)
make run-all

# Or run just the bridge
make run
```

The bridge runs unprivileged using Linux capabilities (`cap_net_raw`, `cap_net_admin`). The build step uses `sudo setcap` to grant these — no root needed at runtime.

The web control plane is available at `http://localhost:3000`. The Go daemon API runs on `http://localhost:8090`.

## Pairing Devices

### Pair your real headphones (outbound)

Put your headphones in pairing mode, then pair them via the **USB dongle** (source adapter):

```bash
bluetoothctl
> select /org/bluez/hci1
> scan on
# Wait for your headphones to appear
> pair AA:BB:CC:DD:EE:FF
> trust AA:BB:CC:DD:EE:FF
> quit
```

Set the MAC address in `config.yaml` under `bluetooth.target_headphone`, or use the web UI Settings page.

### Pair your phone (inbound)

Run the bridge, then on your phone go to Bluetooth settings and connect to "AluNotes Bridge" (or whatever you set as `sink_name`). Pairing is auto-accepted — no PIN required.

The bridge is only discoverable while running. When you stop it (Ctrl+C), the adapter is set to non-discoverable.

## Recordings

Audio is saved as WAV files organized by session:

```
recordings/
  2025-01-15/
    14-30-00/
      recording.wav
    15-45-12/
      recording.wav
```

A session starts when audio begins flowing and ends after the configured idle timeout. Recordings can be browsed, labeled, and favorited through the web UI.

## Project Structure

```
cmd/bridge/            — Main entrypoint
internal/bt/           — Bluetooth sink + source + pairing agent (BlueZ/D-Bus)
internal/audio/        — Pipeline: capture → route → forward + write
internal/session/      — Session lifecycle + idle detection
internal/config/       — YAML configuration loading
internal/api/          — HTTP API server for the web control plane
deploy/                — D-Bus policy, systemd services, install script
alunotes-bt-web/       — Next.js web control plane (oRPC, Prisma, Better Auth)
```

## Makefile Targets

| Target | Description |
|---|---|
| `make setup-permissions` | Install D-Bus policy for non-root BlueZ access (one-time) |
| `make build` | Build for host platform and set BT capabilities |
| `make build-pi` | Cross-compile for RPi 5 (ARM64) |
| `make run` | Build and run the bridge |
| `make run-all` | Build and run bridge (watch mode) + web app |
| `make lint` | Run golangci-lint |
| `make test` | Run tests |
| `make clean` | Remove build artifacts |

## License

MIT
