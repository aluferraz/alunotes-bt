#!/bin/bash
# Probe a backend health endpoint and, while it's unreachable, tear down the
# Bluetooth bridge so paired devices can't keep streaming audio into a broken
# pipeline ("a dummy bluetooth"). When the endpoint recovers, start the bridge
# back up so devices can reconnect.
#
# Tunables (env vars):
#   HEALTH_URL         URL to probe        (default: http://127.0.0.1:3000/api/health)
#   INTERVAL           Seconds between probes                      (default: 10)
#   FAILURE_THRESHOLD  Consecutive fails before bridge teardown     (default: 3)
#   SUCCESS_THRESHOLD  Consecutive successes before bridge restart  (default: 2)
#   CURL_TIMEOUT       Per-probe timeout, seconds                   (default: 3)
#   BRIDGE_UNIT        Systemd unit to stop/start   (default: alunotes-bridge.service)
#   AUTO_RECOVER       "1" to restart the bridge on recovery        (default: 1)
#
# Designed to run as a long-lived systemd service. Stdout/stderr → journald.
set -u

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
INTERVAL="${INTERVAL:-10}"
FAILURE_THRESHOLD="${FAILURE_THRESHOLD:-3}"
SUCCESS_THRESHOLD="${SUCCESS_THRESHOLD:-2}"
CURL_TIMEOUT="${CURL_TIMEOUT:-3}"
BRIDGE_UNIT="${BRIDGE_UNIT:-alunotes-bridge.service}"
AUTO_RECOVER="${AUTO_RECOVER:-1}"

log() { printf '%s supervisor: %s\n' "$(date '+%F %T')" "$*"; }

probe() {
    curl -fsS --max-time "$CURL_TIMEOUT" "$HEALTH_URL" >/dev/null 2>&1
}

# Belt-and-suspenders: `systemctl stop` runs ExecStopPost=bt-poweroff.sh, but
# a hung bridge or ungraceful kill can skip it, so power off adapters directly.
bt_poweroff_all() {
    local found=0
    for idx in $(btmgmt info 2>/dev/null | grep -oP '^hci\K\d+' | sort -u); do
        if btmgmt --index "$idx" power off >/dev/null 2>&1; then
            log "hci$idx powered off"
            found=1
        fi
    done
    [ "$found" -eq 1 ] || log "no BT adapters to power off"
}

teardown_bridge() {
    log "stopping $BRIDGE_UNIT"
    systemctl stop "$BRIDGE_UNIT" || log "systemctl stop returned non-zero"
    bt_poweroff_all
}

restart_bridge() {
    log "starting $BRIDGE_UNIT"
    systemctl start "$BRIDGE_UNIT" || log "systemctl start failed"
}

fails=0
succs=0
state=healthy  # healthy | unhealthy

trap 'log "exiting"; exit 0' INT TERM

log "started url=$HEALTH_URL interval=${INTERVAL}s fail_threshold=$FAILURE_THRESHOLD succ_threshold=$SUCCESS_THRESHOLD"

while :; do
    if probe; then
        fails=0
        if [ "$state" = unhealthy ]; then
            succs=$((succs + 1))
            log "probe ok ($succs/$SUCCESS_THRESHOLD)"
            if [ "$succs" -ge "$SUCCESS_THRESHOLD" ]; then
                log "backend recovered"
                if [ "$AUTO_RECOVER" = "1" ]; then
                    restart_bridge
                else
                    log "AUTO_RECOVER=0 — leaving bridge stopped"
                fi
                state=healthy
                succs=0
            fi
        fi
    else
        succs=0
        if [ "$state" = healthy ]; then
            fails=$((fails + 1))
            log "probe failed ($fails/$FAILURE_THRESHOLD)"
            if [ "$fails" -ge "$FAILURE_THRESHOLD" ]; then
                log "backend unreachable — tearing down bridge"
                teardown_bridge
                state=unhealthy
                fails=0
            fi
        fi
    fi
    sleep "$INTERVAL"
done
