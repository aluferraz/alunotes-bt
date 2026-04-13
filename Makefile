.PHONY: build build-web run run-all kill lint clean tidy setup-permissions deps \
       ai-install ai-configure ai-start ai-pull ai-dev ai-test ai-lint ai-serve

BINARY := alunotes-bridge
BUILD_DIR := ./bin
CMD := ./cmd/bridge

# Build for the host platform and set Bluetooth capabilities.
build: tidy
	go build -o $(BUILD_DIR)/$(BINARY) $(CMD)
	sudo setcap 'cap_net_raw,cap_net_admin+eip' $(BUILD_DIR)/$(BINARY)

# Build for Raspberry Pi 5 (ARM64).
build-pi: tidy
	GOOS=linux GOARCH=arm64 go build -o $(BUILD_DIR)/$(BINARY)-arm64 $(CMD)

# Build the Next.js web app.
build-web:
	cd alunotes-bt-web && pnpm build

# Run the bridge locally.
run: build
	$(BUILD_DIR)/$(BINARY) -config config.yaml

# Kill any running bridge, web dev server, or AI server instances.
kill:
	@-pkill -f '$(BUILD_DIR)/$(BINARY)' 2>/dev/null || true
	@-pkill -f 'next dev' 2>/dev/null || true
	@-pkill -f 'uvicorn alunotes_ai' 2>/dev/null || true
	@sleep 0.5

# Run bridge (watch mode) + web app + ollama + AI server.
# Output is color-prefixed: [bridge]=cyan, [watch]=gray, [web]=magenta, [ai]=yellow.
run-all: kill build
	@echo "Starting bridge (watch mode) + web app + AI server..."
	@$(MAKE) -C alunotes-ai ollama-start
	@PIDFILE=$$(mktemp); \
	CYAN='\x1b[36m'; GRAY='\x1b[90m'; MAGENTA='\x1b[35m'; YELLOW='\x1b[33m'; RESET='\x1b[0m'; \
	cleanup() { \
		kill $$(cat $$PIDFILE 2>/dev/null) 2>/dev/null; \
		kill $$WATCH_PID 2>/dev/null; \
		kill $$WEB_PID 2>/dev/null; \
		kill $$AI_PID 2>/dev/null; \
		rm -f $$PIDFILE; \
		wait 2>/dev/null; \
	}; \
	trap cleanup EXIT; \
	stdbuf -oL $(BUILD_DIR)/$(BINARY) -config config.yaml 2>&1 | sed -u "s/^/$$CYAN[bridge]$$RESET /" & \
	echo $$! > $$PIDFILE; \
	( while inotifywait -r -e modify,create,delete --include '\.go$$' cmd/ internal/; do \
		echo "Go files changed, rebuilding..."; \
		go mod tidy && go build -o $(BUILD_DIR)/$(BINARY) $(CMD) \
			&& sudo setcap 'cap_net_raw,cap_net_admin+eip' $(BUILD_DIR)/$(BINARY) && { \
			echo "Restarting bridge..."; \
			kill $$(cat $$PIDFILE 2>/dev/null) 2>/dev/null; \
			wait $$(cat $$PIDFILE 2>/dev/null) 2>/dev/null; \
			stdbuf -oL $(BUILD_DIR)/$(BINARY) -config config.yaml 2>&1 | sed -u "s/^/$$CYAN[bridge]$$RESET /" & \
			echo $$! > $$PIDFILE; \
		} || echo "Build failed, keeping old binary"; \
	done ) 2>&1 | sed -u "s/^/$$GRAY[watch]$$RESET /" & \
	WATCH_PID=$$!; \
	( cd alunotes-bt-web && pnpm dev ) 2>&1 | sed -u "s/^/$$MAGENTA[web]$$RESET /" & \
	WEB_PID=$$!; \
	( cd alunotes-ai && \
		if [ -f .env ]; then export $$(grep -v '^\s*#' .env | grep '=' | sed 's/^export //' | xargs); fi; \
		.venv/bin/python -m uvicorn alunotes_ai.app:app --host 0.0.0.0 --port 8100 \
	) 2>&1 | sed -u "s/^/$$YELLOW[ai]$$RESET /" & \
	AI_PID=$$!; \
	wait

# Install all system dependencies (bridge + AI).
# Run this once after cloning the repo.
deps:
	sudo apt-get update
	sudo apt-get install -y bluez libdbus-1-dev libsbc-dev pkg-config pulseaudio-utils \
		ffmpeg libsndfile1 libsox-dev sox curl
	$(MAKE) -C alunotes-ai _install-ollama

# Install D-Bus policy and set up permissions for running without root.
# Run this once after cloning the repo.
setup-permissions:
	sudo cp deploy/dbus-alunotes.conf /etc/dbus-1/system.d/alunotes-bridge.conf
	sudo systemctl reload dbus
	@# Ensure PipeWire Bluetooth is enabled (remove any override that disables it).
	rm -f ~/.config/wireplumber/wireplumber.conf.d/90-disable-bluetooth.conf
	systemctl --user restart wireplumber 2>/dev/null || true
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

ai-configure:
	$(MAKE) -C alunotes-ai ollama-configure

ai-start:
	$(MAKE) -C alunotes-ai ollama-start

ai-pull:
	$(MAKE) -C alunotes-ai ollama-pull

ai-dev:
	$(MAKE) -C alunotes-ai dev

ai-test:
	$(MAKE) -C alunotes-ai test

ai-lint:
	$(MAKE) -C alunotes-ai lint

ai-serve:
	$(MAKE) -C alunotes-ai serve
