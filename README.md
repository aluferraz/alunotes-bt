# AluNotes Bridge

A transparent Bluetooth A2DP audio proxy for Raspberry Pi 5. Appears as a Bluetooth headphone to your phone, forwards audio to real headphones, and saves recordings to disk.

## Prerequisites

- Raspberry Pi 5 (or any Linux system with Bluetooth)
- Go 1.22+
- BlueZ 5.x (Bluetooth stack)
- D-Bus development headers

### Install dependencies (Debian/Raspberry Pi OS)

```bash
sudo apt update
sudo apt install -y bluez bluez-tools libdbus-1-dev
```

Ensure the Bluetooth service is running:

```bash
sudo systemctl enable bluetooth
sudo systemctl start bluetooth
```

## Build

```bash
# Build for the current platform
make build

# Build for Raspberry Pi 5 (ARM64 cross-compilation)
make build-pi
```

## Configuration

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

## Pairing Devices

### 1. Pair your real headphones (outbound)

Put your headphones in pairing mode, then pair them via the **USB dongle** (source adapter):

```bash
# Use the USB dongle (hci1) for pairing headphones
bluetoothctl
> select /org/bluez/hci1
> scan on
# Wait for your headphones to appear
> pair AA:BB:CC:DD:EE:FF
> trust AA:BB:CC:DD:EE:FF
> quit
```

Set the MAC address in `config.yaml` under `bluetooth.target_headphone`.

### 2. Pair your phone (inbound)

Run the bridge, then on your phone go to Bluetooth settings and connect to "AluNotes Bridge" (or whatever you set as `sink_name`).

## Run

The bridge requires root (or appropriate Bluetooth capabilities) to manage BlueZ:

```bash
make run
# or directly:
sudo ./bin/alunotes-bridge -config config.yaml
```

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

A session starts when audio begins flowing and ends after the configured idle timeout.

## Project Structure

```
cmd/bridge/        — Main entrypoint
internal/bt/       — Bluetooth sink + source management (BlueZ/D-Bus)
internal/audio/    — Pipeline: capture → route → forward + write
internal/session/  — Session lifecycle + idle detection
internal/config/   — YAML configuration loading
docs/              — Architecture documentation
```

## Makefile Targets

| Target | Description |
|---|---|
| `make build` | Build for host platform |
| `make build-pi` | Cross-compile for RPi 5 (ARM64) |
| `make run` | Build and run with sudo |
| `make lint` | Run golangci-lint |
| `make test` | Run tests |
| `make clean` | Remove build artifacts |

## License

MIT
