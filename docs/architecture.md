# Architecture

## Overview

AluNotes Bridge is a transparent Bluetooth A2DP audio proxy that runs on a
Raspberry Pi 5. It presents itself as a Bluetooth headphone (A2DP sink) to
source devices like phones, while simultaneously forwarding audio to a real
pair of Bluetooth headphones (A2DP source).

All audio passing through the bridge is saved to disk as WAV files, organized
by recording session.

## Component Diagram

```
┌──────────┐   A2DP    ┌──────────────────────────┐   A2DP    ┌──────────────┐
│  Phone   │ ────────► │    AluNotes Bridge       │ ────────► │  Headphones  │
│ (source) │  SBC/AAC  │    (Raspberry Pi 5)      │  SBC/AAC  │   (sink)     │
└──────────┘           │                          │           └──────────────┘
                       │  ┌─────────────────────┐ │
                       │  │  Audio Pipeline      │ │
                       │  │                      │ │
                       │  │  Capture ──► Route ──┤ │
                       │  │               │    │ │ │
                       │  │               ▼    ▼ │ │
                       │  │          Forward  Write│ │
                       │  └─────────────────────┘ │
                       │                          │
                       │  recordings/             │
                       │   2025-01-15/            │
                       │    14-30-00/             │
                       │     recording.wav        │
                       └──────────────────────────┘
```

## Pipeline Stages

Each stage runs as a separate goroutine, connected by Go channels:

1. **Capture**: Reads raw audio from the BlueZ media transport file descriptor
   (the inbound A2DP connection from the phone).

2. **Route**: Fans out each audio buffer to two downstream channels:
   - Forward channel (latency-critical, blocking send)
   - Disk write channel (best-effort, drops buffers if writer falls behind)

3. **Forward**: Writes audio to the outbound BlueZ transport file descriptor
   (the real headphones). If no headphone is connected, buffers are discarded.

4. **Write**: Saves audio to disk as WAV files. Manages session lifecycle
   through the session manager.

## Session Management

A **session** starts when the first audio buffer arrives and ends after a
configurable idle timeout (default: 30 seconds of silence).

- Sessions are stored in: `<base_dir>/YYYY-MM-DD/HH-MM-SS/recording.wav`
- WAV headers are written with placeholder sizes and finalized when the
  session ends, ensuring valid files even for long recordings.
- Silence detection uses peak PCM amplitude against a configurable threshold.

## Bluetooth Stack

The bridge uses **BlueZ** via D-Bus for all Bluetooth operations:

- **Adapter setup**: Powers on the HCI adapter, sets discoverable mode, and
  configures the friendly name.
- **A2DP sink profile**: Registered with BlueZ's ProfileManager so source
  devices can discover and connect.
- **Transport management**: Watches for `MediaTransport1` interface changes
  on D-Bus. When a transport becomes available, it is acquired to get the
  file descriptor for audio I/O.
- **Headphone connection**: Optionally connects outbound to a configured
  headphone MAC address for audio forwarding.

## Configuration

All settings are loaded from a YAML file with sensible defaults. See
`config.yaml.example` for the full schema.
