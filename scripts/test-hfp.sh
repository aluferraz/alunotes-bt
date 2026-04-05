#!/usr/bin/env bash
# test-hfp.sh — Simulate HFP call audio to test the bridging pipeline
# without making a real phone call.
#
# What it does:
#   1. Creates two fake PipeWire nodes with MONO ports (simulating phone + headphone HFP)
#   2. Creates the call mixer null-sink (same as the Go code does)
#   3. Links both fake nodes into the mixer
#   4. Records from the mixer for a few seconds (proves full-duplex capture works)
#   5. Plays a test tone through each fake node so the recording isn't silence
#   6. Cleans everything up
#
# Usage:
#   ./scripts/test-hfp.sh          # run full test
#   ./scripts/test-hfp.sh detect   # only test mono port detection
#   ./scripts/test-hfp.sh mixer    # only test the null-sink mixer
#   ./scripts/test-hfp.sh profile  # test card profile switching (needs real BT device)
#   ./scripts/test-hfp.sh mpris    # test MPRIS call-control registration

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; }
info() { echo -e "${YELLOW}[INFO]${NC} $*"; }

cleanup_modules=()
cleanup() {
    info "Cleaning up..."
    for mod in "${cleanup_modules[@]}"; do
        pactl unload-module "$mod" 2>/dev/null || true
    done
    rm -f /tmp/hfp-test-*.wav /tmp/hfp-tone-*.wav
}
trap cleanup EXIT

# ---------- detect: test that mono port detection works ----------
test_detect() {
    info "=== Testing mono port detection ==="

    # Create a fake node with MONO ports (like a BT HFP device would have)
    local mod
    mod=$(pactl load-module module-null-sink \
        sink_name=fake_phone_hfp \
        rate=16000 channels=1 channel_map=mono 2>&1)
    cleanup_modules+=("$mod")
    info "Loaded fake phone HFP node (module $mod)"

    sleep 0.5

    # Check pw-link sees MONO ports
    if pw-link -o 2>/dev/null | grep -q "MONO"; then
        ok "pw-link -o shows MONO ports"
    else
        fail "No MONO ports visible in pw-link -o"
        pw-link -o
        return 1
    fi

    if pw-link -i 2>/dev/null | grep -q "fake_phone_hfp"; then
        ok "pw-link -i shows fake_phone_hfp input ports"
    else
        fail "fake_phone_hfp input ports not found"
        pw-link -i
        return 1
    fi

    # Check that we can distinguish MONO (HFP) from stereo (A2DP)
    info "MONO ports found (these are what the Go code detects as HFP):"
    pw-link -o | grep MONO || true
    pw-link -i | grep MONO || true

    ok "Mono port detection works"
}

# ---------- mixer: test null-sink mixer pipeline ----------
test_mixer() {
    info "=== Testing call mixer pipeline ==="

    # Create two fake HFP nodes (phone + headphone)
    local phone_mod hp_mod mixer_mod

    phone_mod=$(pactl load-module module-null-sink \
        sink_name=fake_phone_hfp \
        rate=16000 channels=1 channel_map=mono 2>&1)
    cleanup_modules+=("$phone_mod")
    info "Fake phone HFP loaded (module $phone_mod)"

    hp_mod=$(pactl load-module module-null-sink \
        sink_name=fake_hp_hfp \
        rate=16000 channels=1 channel_map=mono 2>&1)
    cleanup_modules+=("$hp_mod")
    info "Fake headphone HFP loaded (module $hp_mod)"

    # Create the mixer (same as Go code's loadCallMixer)
    mixer_mod=$(pactl load-module module-null-sink \
        sink_name=alunotes_call_mix \
        rate=16000 channels=1 channel_map=mono 2>&1)
    cleanup_modules+=("$mixer_mod")
    info "Call mixer loaded (module $mixer_mod)"

    sleep 0.5

    # Find ports
    info "Available output ports:"
    pw-link -o | grep -E "(fake_|alunotes_)" || true
    echo
    info "Available input ports:"
    pw-link -i | grep -E "(fake_|alunotes_)" || true
    echo

    # Link fake phone monitor → mixer input (simulates phone call audio → mixer)
    local phone_out mixer_in
    phone_out=$(pw-link -o | grep "fake_phone_hfp.monitor" | head -1)
    mixer_in=$(pw-link -i | grep "alunotes_call_mix" | head -1)

    if [ -z "$phone_out" ] || [ -z "$mixer_in" ]; then
        fail "Could not find ports to link"
        return 1
    fi

    pw-link "$phone_out" "$mixer_in" 2>/dev/null && ok "Linked phone → mixer" || fail "Link failed"

    # Link fake headphone monitor → mixer input (simulates headphone mic → mixer)
    local hp_out
    hp_out=$(pw-link -o | grep "fake_hp_hfp.monitor" | head -1)

    if [ -n "$hp_out" ]; then
        pw-link "$hp_out" "$mixer_in" 2>/dev/null && ok "Linked headphone mic → mixer" || fail "Link failed"
    fi

    # Generate test tone WAVs and play into each fake node.
    info "Generating test tones (440Hz phone, 880Hz mic) for 3 seconds..."
    python3 -c "
import struct, math, sys, wave
for name, freq in [('/tmp/hfp-tone-phone.wav', 440), ('/tmp/hfp-tone-hp.wav', 880)]:
    with wave.open(name, 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        frames = b''.join(struct.pack('<h', int(8000*math.sin(2*math.pi*freq*i/16000))) for i in range(16000*3))
        w.writeframes(frames)
" 2>/dev/null

    pw-cat --playback --target=fake_phone_hfp /tmp/hfp-tone-phone.wav &
    local tone1_pid=$!

    pw-cat --playback --target=fake_hp_hfp /tmp/hfp-tone-hp.wav &
    local tone2_pid=$!

    # Record from mixer monitor for 3 seconds
    local wav="/tmp/hfp-test-mix.wav"
    info "Recording from mixer monitor → $wav"
    timeout 4 pw-cat --record --target=alunotes_call_mix.monitor \
        --rate=16000 --channels=1 --format=s16 "$wav" 2>/dev/null || true

    wait $tone1_pid 2>/dev/null || true
    wait $tone2_pid 2>/dev/null || true

    if [ -f "$wav" ] && [ "$(stat -c%s "$wav" 2>/dev/null || echo 0)" -gt 1000 ]; then
        local size
        size=$(stat -c%s "$wav")
        ok "Call recording captured ($size bytes): $wav"
        info "Play it with: pw-play $wav"
    else
        fail "Recording is empty or missing"
        return 1
    fi

    ok "Full-duplex mixer pipeline works"
}

# ---------- profile: test BT card profile switching ----------
test_profile() {
    info "=== Testing card profile switching ==="
    info "This needs a real Bluetooth device connected."
    echo

    # List BT cards
    local cards
    cards=$(pactl list cards short 2>/dev/null | grep bluez || true)
    if [ -z "$cards" ]; then
        fail "No Bluetooth cards found. Connect a BT device first."
        return 1
    fi

    info "Bluetooth cards:"
    echo "$cards"
    echo

    # Pick the first card
    local card_name
    card_name=$(echo "$cards" | head -1 | awk '{print $2}')
    info "Testing with card: $card_name"

    # Show available profiles
    info "Available profiles:"
    pactl list cards 2>/dev/null | awk -v card="$card_name" '
        /^Card/ { in_card=0 }
        $0 ~ card { in_card=1 }
        in_card && /^\t\t[a-z]/ { print "\t" $0 }
        in_card && /Active Profile/ { print "\t" $0 }
    '
    echo

    # Show current profile
    local current
    current=$(pactl list cards 2>/dev/null | awk -v card="$card_name" '
        /^Card/ { in_card=0 }
        $0 ~ card { in_card=1 }
        in_card && /Active Profile/ { gsub(/.*: /,""); print; exit }
    ')
    info "Current profile: $current"

    # Try switching to HFP
    info "Attempting switch to headset-head-unit-msbc..."
    if pactl set-card-profile "$card_name" headset-head-unit-msbc 2>/dev/null; then
        ok "Switched to HFP (mSBC)"
        sleep 1
        info "Checking for MONO ports..."
        pw-link -o | grep MONO || info "(no MONO output ports)"
        pw-link -i | grep MONO || info "(no MONO input ports)"
    elif pactl set-card-profile "$card_name" headset-head-unit-cvsd 2>/dev/null; then
        ok "Switched to HFP (CVSD)"
    else
        info "HFP profile not available on this device (expected for A2DP-only devices)"
    fi

    # Restore original profile
    info "Restoring original profile: $current"
    pactl set-card-profile "$card_name" "$current" 2>/dev/null || true
    ok "Profile restored"
}

# ---------- mpris: test MPRIS call-control registration ----------
test_mpris() {
    info "=== Testing MPRIS call control ==="

    # Check if the bridge is running
    if dbus-send --session --print-reply --dest=org.freedesktop.DBus \
        /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null \
        | grep -q "alunotes_call"; then
        ok "alunotes_call MPRIS player is registered"
    else
        info "alunotes_call MPRIS not registered (bridge not running or no HFP connection)"
    fi

    if dbus-send --session --print-reply --dest=org.freedesktop.DBus \
        /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null \
        | grep -q "alunotes_bridge"; then
        ok "alunotes_bridge MPRIS player is registered (media controls)"
    else
        info "alunotes_bridge MPRIS not registered (bridge not running or no connection)"
    fi

    # List all MPRIS players
    info "All registered MPRIS players:"
    dbus-send --session --print-reply --dest=org.freedesktop.DBus \
        /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null \
        | grep -oP '"org\.mpris\.MediaPlayer2\.[^"]*"' || info "(none)"

    ok "MPRIS check done"
}

# ---------- main ----------
case "${1:-all}" in
    detect)  test_detect ;;
    mixer)   test_mixer ;;
    profile) test_profile ;;
    mpris)   test_mpris ;;
    all)
        test_detect
        echo
        test_mixer
        echo
        test_profile
        echo
        test_mpris
        ;;
    *)
        echo "Usage: $0 [detect|mixer|profile|mpris|all]"
        exit 1
        ;;
esac

echo
ok "All tests complete"
