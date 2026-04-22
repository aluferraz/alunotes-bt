#!/usr/bin/env bash
# Dev orchestrator. Colors: [bridge]=cyan, [watch]=gray, [web]=magenta, [ai]=yellow.
#
# The Makefile picks the right prefixes for host-vs-distrobox invocation and
# passes them in as env vars — this script is agnostic:
#
#   HOST_PREFIX      — runs a cmd on the host.
#                      Host: empty. Inside distrobox: "distrobox-host-exec".
#   DBOX_PREFIX      — runs a cmd in the distrobox (argv form).
#                      Host: "distrobox enter NAME --". Inside box: empty.
#   DBOX_BASH_PREFIX — runs a `bash -lc <script>` invocation in the distrobox.
#                      Host: "distrobox enter NAME -- bash -lc". Inside: "bash -lc".
#
# Each service is launched with `setsid`, so its backgrounded PID is the
# leader of a fresh process group. Cleanup runs `kill -- -$PGID`, which
# reaches processes inside the distrobox too (shared host PID namespace).
set -uo pipefail

: "${PROJECT_DIR:?}"
: "${BINARY_PATH:?}"
: "${CMD_PKG:?}"
HOST_PREFIX="${HOST_PREFIX:-}"
DBOX_PREFIX="${DBOX_PREFIX:-}"
DBOX_BASH_PREFIX="${DBOX_BASH_PREFIX:-bash -lc}"

REC_DIR="$PROJECT_DIR/data/recordings"
mkdir -p "$REC_DIR"

CYAN=$'\x1b[36m'; GRAY=$'\x1b[90m'; MAGENTA=$'\x1b[35m'; YELLOW=$'\x1b[33m'; RESET=$'\x1b[0m'

BRIDGE_PGID_FILE=$(mktemp)
: > "$BRIDGE_PGID_FILE"

export PROJECT_DIR BINARY_PATH CMD_PKG REC_DIR
export HOST_PREFIX DBOX_PREFIX DBOX_BASH_PREFIX
export BRIDGE_PGID_FILE
export CYAN GRAY MAGENTA YELLOW RESET

kill_pgid() {
	local pgid=${1:-}
	[ -z "$pgid" ] && return 0
	kill -TERM -- "-$pgid" 2>/dev/null || return 0
	for _ in 1 2 3 4 5; do
		kill -0 -- "-$pgid" 2>/dev/null || return 0
		sleep 0.2
	done
	kill -KILL -- "-$pgid" 2>/dev/null || true
}
export -f kill_pgid

# Launch the bridge in its own session. Uses $HOST_PREFIX so that when this
# script runs inside the distrobox, the bridge still ends up on the host
# (where BT/D-Bus/PipeWire live).
start_bridge() {
	setsid bash -c '
		$HOST_PREFIX env ALUNOTES_STORAGE_BASE_DIR="$REC_DIR" \
			stdbuf -oL "$BINARY_PATH" -config config.yaml 2>&1 \
			| sed -u "s|^|${CYAN}[bridge]${RESET} |"
	' &
	echo "$!" > "$BRIDGE_PGID_FILE"
}
export -f start_bridge

rebuild_bridge() {
	$DBOX_BASH_PREFIX "export PATH=/usr/local/go/bin:\$PATH && cd '$PROJECT_DIR' && CGO_ENABLED=0 go build -o '$BINARY_PATH' $CMD_PKG" || return 1
	$HOST_PREFIX sudo -n setcap 'cap_net_raw,cap_net_admin+eip' "$BINARY_PATH" || return 1
}
export -f rebuild_bridge

watcher_loop() {
	while $DBOX_PREFIX inotifywait -qq -r -e modify,create,delete \
		--include '\.go$' "$PROJECT_DIR/cmd/" "$PROJECT_DIR/internal/"; do
		echo "Go files changed, rebuilding..."
		if rebuild_bridge; then
			echo "Restarting bridge..."
			kill_pgid "$(cat "$BRIDGE_PGID_FILE" 2>/dev/null)"
			start_bridge
		else
			echo "Build failed, keeping old binary"
		fi
	done
}
export -f watcher_loop

start_watcher() {
	setsid bash -c 'watcher_loop 2>&1 | sed -u "s|^|${GRAY}[watch]${RESET} |"' &
	WATCH_PGID=$!
}

start_web() {
	setsid bash -c '
		$DBOX_BASH_PREFIX "cd \"$PROJECT_DIR/alunotes-bt-web\" && export RECORDINGS_DIR=\"$REC_DIR\" && exec pnpm dev" 2>&1 \
			| sed -u "s|^|${MAGENTA}[web]${RESET} |"
	' &
	WEB_PGID=$!
}

start_ai() {
	setsid bash -c '
		$DBOX_BASH_PREFIX "cd \"$PROJECT_DIR/alunotes-ai\" && \
			if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
			exec .venv/bin/python -m uvicorn alunotes_ai.app:app \
				--host 0.0.0.0 --port 8100 --reload --reload-dir alunotes_ai" 2>&1 \
			| sed -u "s|^|${YELLOW}[ai]${RESET} |"
	' &
	AI_PGID=$!
}

WATCH_PGID=""; WEB_PGID=""; AI_PGID=""

cleanup() {
	local ec=${1:-0}
	set +e
	trap - EXIT INT TERM
	echo
	echo "==> Cleaning up..."
	kill_pgid "$(cat "$BRIDGE_PGID_FILE" 2>/dev/null)"
	kill_pgid "$WATCH_PGID"
	kill_pgid "$WEB_PGID"
	kill_pgid "$AI_PGID"
	rm -f "$BRIDGE_PGID_FILE"
	echo "==> Done."
	exit "$ec"
}
trap 'cleanup 130' INT
trap 'cleanup 143' TERM
trap 'cleanup 0'   EXIT

cd "$PROJECT_DIR"

echo "==> Starting bridge (host) + web/ai (distrobox)"
start_bridge
start_watcher
start_web
start_ai

# Block until any child exits on its own; traps handle Ctrl+C.
wait -n 2>/dev/null || true
cleanup 1
