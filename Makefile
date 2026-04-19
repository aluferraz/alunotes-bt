.PHONY: build build-pi build-web build-box build-all run run-all kill lint clean tidy \
       setup-permissions deps-box host-install-docker install-systemd uninstall \
       up down restart status logs enable disable \
       ai-install ai-dev ai-test ai-lint ai-serve

SYSTEM_SVCS := alunotes-bt-rfkill alunotes-bridge alunotes-ai alunotes-web

BINARY := alunotes-bridge
BUILD_DIR := ./bin
CMD := ./cmd/bridge
DISTROBOX_NAME ?= ubuntu24

# Container runtime used by build-all / host-install-docker. We default to
# docker because the bridge needs tight BT/D-Bus integration and we run the
# daemon directly on the host. Override with CONTAINER=podman if you prefer.
CONTAINER ?= docker

# Detect running inside a distrobox/toolbox container. When invoked from
# inside the box, host-only commands (docker, sudo systemctl, setcap, the
# native bridge binary that needs BT/D-Bus/PipeWire) hop to the host via
# distrobox-host-exec, and "distrobox enter" wrappers are no-ops. On the host
# the vars are empty / expand to the usual "distrobox enter" prefix.
IN_DISTROBOX := $(shell [ -f /run/.containerenv ] && echo 1)

ifeq ($(IN_DISTROBOX),1)
HOST      := distrobox-host-exec
DBOX      :=
DBOX_BASH := bash -lc
else
HOST      :=
DBOX      := distrobox enter $(DISTROBOX_NAME) --
DBOX_BASH := distrobox enter $(DISTROBOX_NAME) -- bash -lc
endif

# Fully static pure-Go build (no cgo). Matches Dockerfile.bridge.
build: tidy
	CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o $(BUILD_DIR)/$(BINARY) $(CMD)
	$(HOST) sudo setcap 'cap_net_raw,cap_net_admin+eip' $(BUILD_DIR)/$(BINARY)

# Build for Raspberry Pi 5 (ARM64).
build-pi: tidy
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o $(BUILD_DIR)/$(BINARY)-arm64 $(CMD)

# Build bridge inside the distrobox (toolchain not required on host).
build-box:
	$(DBOX_BASH) \
		'export PATH=/usr/local/go/bin:$$PATH && cd $(CURDIR) && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY) $(CMD)'
	$(HOST) sudo setcap 'cap_net_raw,cap_net_admin+eip' $(BUILD_DIR)/$(BINARY)

# Build all container images. The runtime ($(CONTAINER)) runs on the host,
# so from inside the distrobox these hop to the host via distrobox-host-exec.
build-all:
	$(HOST) $(CONTAINER) build -f Dockerfile.bridge -t alunotes/bridge .
	$(HOST) $(CONTAINER) build -f alunotes-ai/Dockerfile -t alunotes/ai ./alunotes-ai
	$(HOST) $(CONTAINER) build -f alunotes-bt-web/Dockerfile -t alunotes/web ./alunotes-bt-web

# Build the Next.js web app (pnpm lives inside the distrobox).
build-web:
	$(DBOX_BASH) 'cd $(CURDIR)/alunotes-bt-web && pnpm build'

# Run the bridge locally.
run: build
	$(HOST) $(BUILD_DIR)/$(BINARY) -config config.yaml

# Kill any leftover dev-mode processes (belt-and-suspenders for the trap in run-all).
kill:
	@-pkill -f '$(BUILD_DIR)/$(BINARY)' 2>/dev/null || true
	@-pkill -f 'pnpm dev' 2>/dev/null || true
	@-pkill -f 'next dev' 2>/dev/null || true
	@-pkill -f 'uvicorn alunotes_ai' 2>/dev/null || true
	@sleep 0.5

# Dev mode: bridge runs native on host (needs BT/D-Bus/PipeWire hardware);
# go rebuild, pnpm dev, and uvicorn all execute inside the distrobox so the
# host stays free of Go/Node/Python toolchains.
# Output is color-prefixed: [bridge]=cyan, [watch]=gray, [web]=magenta, [ai]=yellow.
run-all: kill
	@echo "==> Initial bridge build"
	@$(DBOX_BASH) \
		'export PATH=/usr/local/go/bin:$$PATH && cd $(CURDIR) && CGO_ENABLED=0 go build -o $(BUILD_DIR)/$(BINARY) $(CMD)'
	@$(HOST) sudo -v
	@$(HOST) sudo setcap 'cap_net_raw,cap_net_admin+eip' $(BUILD_DIR)/$(BINARY)
	@echo "==> Starting bridge (host) + web/ai (distrobox)"
	@PIDFILE=$$(mktemp); \
	CYAN='\x1b[36m'; GRAY='\x1b[90m'; MAGENTA='\x1b[35m'; YELLOW='\x1b[33m'; RESET='\x1b[0m'; \
	cleanup() { \
		kill $$(cat $$PIDFILE 2>/dev/null) 2>/dev/null; \
		kill $$WATCH_PID $$WEB_PID $$AI_PID 2>/dev/null; \
		rm -f $$PIDFILE; \
		wait 2>/dev/null; \
	}; \
	trap cleanup EXIT INT TERM; \
	$(HOST) stdbuf -oL $(BUILD_DIR)/$(BINARY) -config config.yaml 2>&1 | sed -u "s/^/$$CYAN[bridge]$$RESET /" & \
	echo $$! > $$PIDFILE; \
	( while $(DBOX) inotifywait -qq -r -e modify,create,delete --include '\.go$$' $(CURDIR)/cmd/ $(CURDIR)/internal/; do \
		echo "Go files changed, rebuilding..."; \
		$(DBOX_BASH) \
			'export PATH=/usr/local/go/bin:$$PATH && cd $(CURDIR) && CGO_ENABLED=0 go build -o $(BUILD_DIR)/$(BINARY) $(CMD)' \
		&& $(HOST) sudo -n setcap 'cap_net_raw,cap_net_admin+eip' $(BUILD_DIR)/$(BINARY) && { \
			echo "Restarting bridge..."; \
			kill $$(cat $$PIDFILE 2>/dev/null) 2>/dev/null; \
			wait $$(cat $$PIDFILE 2>/dev/null) 2>/dev/null; \
			$(HOST) stdbuf -oL $(BUILD_DIR)/$(BINARY) -config config.yaml 2>&1 | sed -u "s/^/$$CYAN[bridge]$$RESET /" & \
			echo $$! > $$PIDFILE; \
		} || echo "Build failed, keeping old binary"; \
	done ) 2>&1 | sed -u "s/^/$$GRAY[watch]$$RESET /" & \
	WATCH_PID=$$!; \
	$(DBOX_BASH) \
		'cd $(CURDIR)/alunotes-bt-web && exec pnpm dev' \
		2>&1 | sed -u "s/^/$$MAGENTA[web]$$RESET /" & \
	WEB_PID=$$!; \
	$(DBOX_BASH) \
		'cd $(CURDIR)/alunotes-ai && \
		 if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
		 exec .venv/bin/python -m uvicorn alunotes_ai.app:app \
		      --host 0.0.0.0 --port 8100 \
		      --reload --reload-dir alunotes_ai' \
		2>&1 | sed -u "s/^/$$YELLOW[ai]$$RESET /" & \
	AI_PID=$$!; \
	wait

# Install the full stack via systemd on the host. Builds inside distrobox.
install-systemd:
	$(HOST) ./deploy/install.sh

# ---------- stack control ----------
# up/down drive the docker-compose stack on the host. Other targets below
# (restart/status/logs/enable/disable) still operate on the systemd units
# installed by `install-systemd`.

up:
	@# Pre-create host-mounted data dir with current uid so the bridge (running
	@# as ${PUID:-1000}) can write device_id / logs. Otherwise docker creates
	@# the missing source path as root and the non-root container fails.
	mkdir -p data/bridge
	$(HOST) $(CONTAINER) compose up -d

down:
	$(HOST) $(CONTAINER) compose down

restart:
	$(HOST) sudo systemctl restart $(SYSTEM_SVCS)

status:
	@$(HOST) sudo systemctl --no-pager status $(SYSTEM_SVCS) || true

# Follow logs from all app services (Ctrl+C to exit).
logs:
	$(HOST) sudo journalctl -f $(foreach s,$(SYSTEM_SVCS),-u $(s))

enable:
	$(HOST) sudo systemctl enable $(SYSTEM_SVCS)

disable:
	$(HOST) sudo systemctl disable $(SYSTEM_SVCS)

# Remove installed unit files + D-Bus policy. Leaves Ollama and build artifacts.
uninstall:
	$(HOST) sudo systemctl stop $(SYSTEM_SVCS) 2>/dev/null || true
	$(HOST) sudo systemctl disable $(SYSTEM_SVCS) 2>/dev/null || true
	$(HOST) sudo rm -f /etc/systemd/system/alunotes-bt-rfkill.service \
	                   /etc/systemd/system/alunotes-bridge.service \
	                   /etc/systemd/system/alunotes-ai.service \
	                   /etc/systemd/system/alunotes-web.service \
	                   /etc/dbus-1/system.d/alunotes-bridge.conf
	$(HOST) sudo systemctl daemon-reload

# Install build toolchains (go/node/pnpm/python venv + AI apt libs) inside the
# distrobox. The bridge is pure Go (CGO disabled), so the host needs zero
# build-time apt packages — only runtime deps already shipped by SteamOS
# (bluez, dbus, pipewire, rfkill, btmgmt, bluetoothctl).
deps-box:
	$(DBOX_BASH) '\
		sudo apt-get update -qq && \
		sudo apt-get install -y --no-install-recommends \
			build-essential curl ca-certificates git \
			ffmpeg libsndfile1 libsox-dev sox \
			python3 python3-venv python3-pip \
			inotify-tools'

# Install docker on the host (SteamOS). Required so build-all and container
# runtime can talk to real BT/D-Bus devices. Safe to re-run. Runs on the host
# even when invoked from inside the distrobox.
host-install-docker:
	$(HOST) ./deploy/install-docker.sh

# Install D-Bus policy and set up permissions for running without root.
# Run this once after cloning the repo. D-Bus and wireplumber live on the
# host, so those bits hop via distrobox-host-exec when invoked from the box.
setup-permissions:
	$(HOST) sudo mkdir -p /etc/dbus-1/system.d
	$(HOST) sudo install -m 0644 deploy/dbus-alunotes.conf /etc/dbus-1/system.d/alunotes-bridge.conf
	$(HOST) sudo systemctl reload dbus
	@# Ensure PipeWire Bluetooth is enabled (remove any override that disables it).
	rm -f ~/.config/wireplumber/wireplumber.conf.d/90-disable-bluetooth.conf
	$(HOST) systemctl --user restart wireplumber 2>/dev/null || true
	@echo "D-Bus policy installed. You can now run the bridge without root."

# Run go mod tidy.
tidy:
	go mod tidy

# Lint with golangci-lint (if installed).
lint:
	golangci-lint run ./...

# Run tests.
test:
	go test ./...

# Remove build artifacts.
clean:
	rm -rf $(BUILD_DIR)

# ---------- alunotes-ai targets ----------

ai-install:
	$(MAKE) -C alunotes-ai install

ai-dev:
	$(MAKE) -C alunotes-ai dev

ai-test:
	$(MAKE) -C alunotes-ai test

ai-lint:
	$(MAKE) -C alunotes-ai lint

ai-serve:
	$(MAKE) -C alunotes-ai serve
