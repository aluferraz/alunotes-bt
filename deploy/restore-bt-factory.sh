#!/usr/bin/env bash
# Removes alunotes-bt-class.service and power-cycles hci0 so the controller's
# firmware-default Class of Device reasserts.
#
# Usage: sudo ./deploy/restore-bt-factory.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "must be run as root (sudo $0)" >&2
  exit 1
fi

UNIT=/etc/systemd/system/alunotes-bt-class.service

if systemctl list-unit-files alunotes-bt-class.service >/dev/null 2>&1 \
   && systemctl is-enabled --quiet alunotes-bt-class.service 2>/dev/null; then
  systemctl disable --now alunotes-bt-class.service
elif systemctl is-active --quiet alunotes-bt-class.service 2>/dev/null; then
  systemctl stop alunotes-bt-class.service
fi

rm -f "$UNIT"
systemctl daemon-reload

echo "Class before cycle: $(bluetoothctl show 2>/dev/null | awk '/Class:/{print $2; exit}')"

rfkill block bluetooth
sleep 1
rfkill unblock bluetooth

# Give bluetoothd a moment to repopulate adapter state after unblock.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  cls=$(bluetoothctl show 2>/dev/null | awk '/Class:/{print $2; exit}')
  [ -n "${cls:-}" ] && break
  sleep 1
done

echo "Class after cycle:  ${cls:-<unavailable>}"
echo "Done."
