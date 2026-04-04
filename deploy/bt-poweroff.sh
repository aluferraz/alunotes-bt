#!/bin/bash
# Safety net: power off all Bluetooth adapters when the bridge stops.
# Called by systemd ExecStopPost to handle crashes/SIGKILL.
for hci in $(hciconfig -a 2>/dev/null | grep -oP '^hci\d+'); do
    hciconfig "$hci" down 2>/dev/null && echo "Powered off $hci" || true
done
