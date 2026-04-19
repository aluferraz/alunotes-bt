#!/bin/bash
# Safety net: power off all Bluetooth adapters when the bridge stops.
# Called by systemd ExecStopPost to cover crashes / SIGKILL.
# The Go binary handles graceful shutdown itself.
set +e

for idx in $(btmgmt info 2>/dev/null | grep -oP '^hci\K\d+' | sort -u); do
    if btmgmt --index "$idx" power off >/dev/null 2>&1; then
        echo "Powered off hci$idx"
    fi
done
exit 0
