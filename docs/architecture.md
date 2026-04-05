# Architecture

## Overview

AluNotes Bridge is a transparent Bluetooth audio proxy on Raspberry Pi 5. It presents itself as a Bluetooth headphone (A2DP sink) to phones while forwarding audio to real headphones (A2DP source). When a phone call comes in, it detects the HFP profile switch, routes bidirectional SCO call audio, and records both sides.

The Go daemon is purely a **control plane** — it manages BlueZ D-Bus connections, PipeWire routing commands, and recording lifecycle. Audio data never flows through Go code; PipeWire routes it natively between Bluetooth adapters.

## Dual-adapter design

A single Bluetooth adapter cannot reliably serve as both A2DP sink and source. The bridge uses two adapters:

- **hci0** (USB dongle) — A2DP sink, receives audio from the phone
- **hci1** (onboard) — A2DP source, sends audio to the headphone

## Component diagram

```
┌──────────┐  A2DP/HFP  ┌────────────────────────────────────┐  A2DP/HFP  ┌──────────────┐
│  Phone   │ ──────────► │         Raspberry Pi 5             │ ──────────► │  Headphones  │
│  (AG)    │   hci0      │                                    │   hci1      │  (AirPods)   │
└──────────┘             │  ┌──────────────────────────────┐  │             └──────────────┘
                         │  │         PipeWire              │  │
                         │  │                               │  │
                         │  │  A2DP: phone node ──► hp node │  │
                         │  │  HFP:  phone SCO ◄──► hp SCO │  │
                         │  │          │                    │  │
                         │  │          ▼                    │  │
                         │  │     null-sink mixer           │  │
                         │  │          │                    │  │
                         │  │          ▼                    │  │
                         │  │     pw-cat ──► WAV            │  │
                         │  └──────────────────────────────┘  │
                         │                                    │
                         │  ┌──────────────────────────────┐  │
                         │  │      Go daemon (control)     │  │
                         │  │                               │  │
                         │  │  D-Bus signals ──► transport  │  │
                         │  │  pactl ──► profile switching  │  │
                         │  │  pw-link ──► port routing     │  │
                         │  │  MPRIS ──► media controls     │  │
                         │  │  HTTP API ──► web UI          │  │
                         │  └──────────────────────────────┘  │
                         └────────────────────────────────────┘
```

## Audio flow (A2DP music)

PipeWire handles all codec negotiation and audio routing. The Go daemon only:

1. Watches D-Bus for `MediaTransport1` events (phone connected/disconnected)
2. Starts `pw-cat --record` targeting the phone's PipeWire node (WAV capture)
3. Runs `AVRCPSync` for volume + media control forwarding

Audio quality is **identical** to a direct phone→headphone connection. PipeWire re-encodes for the headphone's negotiated codec (typically SBC or AAC) but the Go daemon never reads or modifies audio data.

## Audio flow (HFP phone call)

When a call is detected:

```
1. Phone card profile switches: a2dp-sink → headset-head-unit
   └── Detected by HFPRouter via pactl subscribe + pactl list cards

2. HFPRouter.startCall():
   ├── pactl set-card-profile headphone → headset-head-unit (mSBC)
   ├── pw-link phone_SCO_output → headphone_SCO_input  (caller voice → ear)
   ├── pw-link headphone_SCO_output → phone_SCO_input   (mic → caller)
   ├── pactl load-module module-null-sink (mixer for recording)
   ├── pw-link phone_SCO_output → mixer
   ├── pw-link headphone_SCO_output → mixer
   └── pw-cat --record --target=mixer.monitor → call-*.wav

3. Call ends: phone card profile switches back to a2dp-sink
   └── HFPRouter.endCall():
       ├── Cancel recording (SIGINT pw-cat)
       ├── pactl unload-module (remove mixer)
       └── pactl set-card-profile headphone → a2dp-sink
```

### Call detection

The HFP router checks the **phone's PipeWire card active profile**, not MONO port presence. This avoids false positives — BlueZ keeps idle HFP nodes registered alongside A2DP even when no call is happening.

```go
// isCardInHFP checks pactl list cards for headset-head-unit profile
func isCardInHFP(ctx, mac) bool
```

### Call recording

Both call directions are mixed into a single WAV via a PipeWire null-sink:

- Phone SCO output (caller's voice) → null-sink input
- Headphone SCO output (user's mic) → null-sink input
- null-sink monitor → pw-cat → `call-*.wav` (16kHz mono)

If the null-sink can't be created, falls back to recording the phone side only.

### Call controls

A persistent MPRIS player (`org.mpris.MediaPlayer2.alunotes_call`) stays registered on the session D-Bus across A2DP↔HFP transitions. During calls, it forwards headphone AVRCP button presses to the phone's `MediaPlayer1`. Most phone OSes interpret AVRCP Play/Pause as answer/hangup during active calls.

## Media control forwarding

Headphone button presses flow through:

```
AirPods button → AVRCP → mpris-proxy → session D-Bus MPRIS
  → AVRCPSync.mprisPlayer → BlueZ MediaPlayer1.Play/Pause/Next/Previous
  → phone
```

## Volume sync

Bidirectional via BlueZ `MediaTransport1.Volume` D-Bus property changes:

```
Phone volume change → D-Bus signal → AVRCPSync → set headphone transport volume
Headphone volume change → D-Bus signal → AVRCPSync → set phone transport volume
```

## Session management

- A session starts on first audio (`Touch()`)
- Ends after `idle_timeout` of no `Touch()` calls (default 30s)
- Directory: `<base_dir>/YYYY-MM-DD/HH-MM-SS/`
- Music: `recording-*.wav` (44.1kHz stereo)
- Calls: `call-*.wav` (16kHz mono, both sides)

## Lifecycle coordination

The HFP router runs on the **main context** (not the A2DP pipeline context) so it survives the A2DP transport teardown that happens when the phone switches profiles during a call:

```
Phone connects (A2DP)
  ├── pipeCtx created
  ├── AVRCPSync.Run(pipeCtx)       ← dies when A2DP tears down
  ├── pwCapture.Run(pipeCtx)       ← dies when A2DP tears down
  └── HFPRouter.Run(hfpCtx=main)   ← survives, detects call

Call starts → A2DP transport idle → pipeCtx cancelled
  └── HFPRouter detects call → routes SCO → records

Call ends → A2DP transport reappears → new pipeCtx
  ├── HFPRouter restores headphone
  ├── New AVRCPSync starts
  └── New pwCapture starts
```

## Configuration

See [config.yaml](../config.yaml). All settings have defaults. The only required setting for headphone forwarding is `bluetooth.target_headphone`.
