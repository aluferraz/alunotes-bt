.PHONY: build build-pi build-web build-box build-all run run-all kill kill-running lint clean tidy \
       setup-permissions deps-box host-install-docker install-systemd install-supervisor \
       uninstall uninstall-supervisor \
       up down restart status logs enable disable stop \
       ai-install ai-dev ai-test ai-lint ai-serve ai-fetch-models

SYSTEM_SVCS := alunotes-bt-rfkill alunotes-bridge alunotes-ai alunotes-web

BINARY := alunotes-bridge
BUILD_DIR := ./bin
CMD := ./cmd/bridge
DISTROBOX_NAME ?= ubuntu24

# Container runtime used by build-all / host-install-docker. We default to
# docker because the bridge needs tight BT/D-Bus integration and we run the
# daemon directly on the host. Override with CONTAINER=podman if you prefer.
CONTAINER ?= docker

# GPU backend for the ai image (cpu | rocm | cuda). Auto-detected by
# scripts/detect-gpu.sh on the host, overridable via `AI_GPU_BACKEND=cpu make …`.
# Evaluated lazily (`?=` would eagerly bake in any leaked shell value) so the
# `make build-all AI_GPU_BACKEND=cpu` form still wins over detection.
AI_GPU_BACKEND ?= $(shell bash $(CURDIR)/scripts/detect-gpu.sh 2>/dev/null || echo cpu)

# GPU-specific compose overlay — adds /dev/kfd, /dev/dri and HSA override for
# ROCm hosts. Only included when a GPU backend was detected / requested; on
# CPU-only hosts the base compose file is used unchanged.
ifneq ($(AI_GPU_BACKEND),cpu)
COMPOSE_FILES := -f docker-compose.yml -f docker-compose.gpu.yml
else
COMPOSE_FILES :=
endif

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
#
# The ai image is GPU-aware: AI_GPU_BACKEND is forwarded to compose, which
# passes it as --build-arg to the Dockerfile (so the torch wheel matches the
# host). Default is the auto-detected backend; override with
#   make build-all AI_GPU_BACKEND=cpu
build-all:
	@echo "==> ai image GPU backend: $(AI_GPU_BACKEND)"
	$(HOST) $(CONTAINER) buildx build --load -f Dockerfile.bridge -t alunotes/bridge .
	@# Go through compose so the `secrets:` block (HF_TOKEN for the ai image's
	@# model-downloader stage) is actually applied — a raw `buildx build` would
	@# drop it and fail with "HF_TOKEN is required".
	$(HOST) env AI_GPU_BACKEND=$(AI_GPU_BACKEND) $(CONTAINER) compose build ai
	$(HOST) $(CONTAINER) buildx build --load -f alunotes-bt-web/Dockerfile -t alunotes/web ./alunotes-bt-web

# Build the Next.js web app (pnpm lives inside the distrobox).
build-web:
	$(DBOX_BASH) 'cd $(CURDIR)/alunotes-bt-web && pnpm build'

# Run the bridge locally. In dev we point the recordings dir at
# $(CURDIR)/data/recordings so the native bridge and the Next.js dev server
# agree on one on-disk location without touching the docker-mode config.yaml
# path (/data/recordings, an absolute path that only exists inside the
# bridge container).
run: build
	mkdir -p data/recordings
	$(HOST) env ALUNOTES_STORAGE_BASE_DIR=$(CURDIR)/data/recordings \
		$(BUILD_DIR)/$(BINARY) -config config.yaml

# Kill any leftover dev-mode processes (belt-and-suspenders for the trap in run-all).
kill:
	@-pkill -f '$(BUILD_DIR)/$(BINARY)' 2>/dev/null || true
	@-pkill -f 'pnpm dev' 2>/dev/null || true
	@-pkill -f 'next dev' 2>/dev/null || true
	@-pkill -f 'uvicorn alunotes_ai' 2>/dev/null || true
	@sleep 0.5

# Nuclear stop: systemd units + compose stack + any escaped dev/prod processes.
# Use when docker compose up complains about ports already in use, or after a
# crashed run-all leaves orphans. Safe to run repeatedly.
kill-running:
	@echo "==> Stopping systemd units"
	@-$(HOST) sudo systemctl stop $(SYSTEM_SVCS) alunotes-supervisor 2>/dev/null || true
	@echo "==> Tearing down docker compose stack"
	@-$(HOST) $(CONTAINER) compose down --remove-orphans 2>/dev/null || true
	@echo "==> Killing escaped distrobox/dev processes"
	@-$(HOST) sudo pkill -f '$(BUILD_DIR)/$(BINARY)' 2>/dev/null || true
	@-$(HOST) pkill -f 'next-server' 2>/dev/null || true
	@-$(HOST) pkill -f 'next dev' 2>/dev/null || true
	@-$(HOST) pkill -f 'next start' 2>/dev/null || true
	@-$(HOST) pkill -f 'pnpm start' 2>/dev/null || true
	@-$(HOST) pkill -f 'pnpm dev' 2>/dev/null || true
	@-$(HOST) pkill -f 'uvicorn alunotes_ai' 2>/dev/null || true
	@-$(HOST) pkill -f 'distrobox.*enter.*alunotes' 2>/dev/null || true
	@-$(HOST) pkill -f 'podman exec.*alunotes' 2>/dev/null || true
	@sleep 0.5
	@echo "Done."

# Dev mode: bridge runs native on host (needs BT/D-Bus/PipeWire hardware);
# go rebuild, pnpm dev, and uvicorn all execute inside the distrobox so the
# host stays free of Go/Node/Python toolchains.
# Orchestration (signal handling, PGID tracking, color-prefixed logs) lives in
# scripts/run-all.sh — the prior in-Makefile version caught the wrong PIDs
# and left services orphaned on Ctrl+C.
run-all: kill
	@echo "==> Initial bridge build"
	@$(DBOX_BASH) \
		'export PATH=/usr/local/go/bin:$$PATH && cd $(CURDIR) && CGO_ENABLED=0 go build -o $(BUILD_DIR)/$(BINARY) $(CMD)'
	@$(HOST) sudo -v
	@$(HOST) sudo setcap 'cap_net_raw,cap_net_admin+eip' $(BUILD_DIR)/$(BINARY)
	@PROJECT_DIR=$(CURDIR) \
	 BINARY_PATH=$(CURDIR)/$(BUILD_DIR:./%=%)/$(BINARY) \
	 CMD_PKG=$(CMD) \
	 HOST_PREFIX='$(HOST)' \
	 DBOX_PREFIX='$(DBOX)' \
	 DBOX_BASH_PREFIX='$(DBOX_BASH)' \
	 bash $(CURDIR)/scripts/run-all.sh

# Install the full stack via systemd on the host. Builds inside distrobox.
install-systemd:
	$(HOST) ./deploy/install.sh

# Install the supervisor unit. Watches the web app's /api/health and tears
# down the bridge (+ powers off BT adapters) whenever it's unreachable, so
# paired devices don't stream audio into a dead pipeline. Idempotent.
install-supervisor:
	@TMPF=$$(mktemp); \
	sed 's|@PROJECT_DIR@|$(CURDIR)|g' deploy/alunotes-supervisor.service > $$TMPF; \
	$(HOST) sudo install -m 0644 $$TMPF /etc/systemd/system/alunotes-supervisor.service; \
	rm -f $$TMPF
	$(HOST) sudo systemctl daemon-reload
	$(HOST) sudo systemctl enable --now alunotes-supervisor.service
	@echo "Supervisor installed. Follow logs: sudo journalctl -u alunotes-supervisor -f"

# Remove just the supervisor unit (leaves the rest of the stack alone).
uninstall-supervisor:
	$(HOST) sudo systemctl disable --now alunotes-supervisor.service 2>/dev/null || true
	$(HOST) sudo rm -f /etc/systemd/system/alunotes-supervisor.service
	$(HOST) sudo systemctl daemon-reload
	@echo "Supervisor removed."

# ---------- stack control ----------
# up/down drive the docker-compose stack on the host. Other targets below
# (restart/status/logs/enable/disable) still operate on the systemd units
# installed by `install-systemd`.

up:
	@# Pre-create host-mounted data dirs with current uid so the containers
	@# (bridge as ${PUID:-1000}, ai as its system user `alunotes`) can write
	@# into them. Otherwise docker creates the missing source paths as root
	@# and the non-root container fails.
	@# miopen-cache only needed on GPU runs; creating it unconditionally is
	@# cheap and keeps `up` idempotent regardless of backend.
	mkdir -p data/bridge data/miopen-cache
	@# MIOpen cache must be writable by the container's unprivileged user
	@# whose uid is fixed at image-build time (system user, not host-matched).
	@# 0777 on this local dev-data path is the simplest thing that works.
	chmod 0777 data/miopen-cache
	@echo "==> Starting stack (ai GPU backend: $(AI_GPU_BACKEND))"
	$(HOST) env AI_GPU_BACKEND=$(AI_GPU_BACKEND) $(CONTAINER) compose $(COMPOSE_FILES) up

down:
	$(HOST) $(CONTAINER) compose $(COMPOSE_FILES) down

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
# Stop the installed systemd services without removing unit files.
stop:
	$(HOST) sudo systemctl stop $(SYSTEM_SVCS) 2>/dev/null || true
# Remove installed unit files + D-Bus policy. Leaves Ollama and build artifacts.
uninstall:
	$(HOST) sudo systemctl stop $(SYSTEM_SVCS) alunotes-supervisor 2>/dev/null || true
	$(HOST) sudo systemctl disable $(SYSTEM_SVCS) alunotes-supervisor 2>/dev/null || true
	$(HOST) sudo rm -f /etc/systemd/system/alunotes-bt-rfkill.service \
	                   /etc/systemd/system/alunotes-bridge.service \
	                   /etc/systemd/system/alunotes-ai.service \
	                   /etc/systemd/system/alunotes-web.service \
	                   /etc/systemd/system/alunotes-supervisor.service \
	                   /etc/dbus-1/system.d/alunotes-bridge.conf
	$(HOST) sudo systemctl daemon-reload

# Install build toolchains (go/node/pnpm/python venv + AI apt libs) inside the
# distrobox. The bridge is pure Go (CGO disabled), so the host needs zero
# build-time apt packages — only runtime deps already shipped by SteamOS
# (bluez, dbus, pipewire, rfkill, btmgmt, bluetoothctl).
# pciutils is for the GPU auto-detect script (scripts/detect-gpu.sh);
# libnuma1 + libdrm2 are runtime deps of the torch-rocm wheel on AMD GPUs
# — both are tiny and harmless on non-ROCm hosts, so we install them
# unconditionally rather than branching on GPU.
# librocrand-dev + rocm-device-libs-17 are needed at JIT-compile time: the
# torch-rocm pip wheel ships libMIOpen.so + librocrand.so but NOT their
# development headers, so MIOpen's runtime kernel compiler (used on first
# forward pass for dropout/etc) fails with "rocrand/rocrand_xorwow.h file
# not found". Ubuntu 24.04 has these in the stock repos, no AMD repo needed.
deps-box:
	$(DBOX_BASH) '\
		sudo apt-get update -qq && \
		sudo apt-get install -y --no-install-recommends \
			build-essential curl ca-certificates git \
			ffmpeg libsndfile1 libsox-dev sox \
			python3 python3-venv python3-pip \
			inotify-tools \
			pciutils libnuma1 libdrm2 \
			librocrand-dev rocm-device-libs-17'

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

# Populate the host-side HF cache so `make run-all` works offline. The docker
# image has its own cache baked in at build time (see alunotes-ai/Dockerfile),
# this target is only for dev-mode uvicorn running against the host .venv.
# Reads HF_TOKEN from alunotes-ai/.env.
ai-fetch-models:
	$(DBOX_BASH) 'cd $(CURDIR)/alunotes-ai && \
		set -a && . ./.env && set +a && \
		HF_HUB_OFFLINE=0 .venv/bin/python scripts/download_models.py'

