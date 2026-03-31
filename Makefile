.PHONY: build run lint clean tidy

BINARY := alunotes-bridge
BUILD_DIR := ./bin
CMD := ./cmd/bridge

# Build for the host platform.
build: tidy
	go build -o $(BUILD_DIR)/$(BINARY) $(CMD)

# Build for Raspberry Pi 5 (ARM64).
build-pi: tidy
	GOOS=linux GOARCH=arm64 go build -o $(BUILD_DIR)/$(BINARY)-arm64 $(CMD)

# Run the bridge locally.
run: build
	sudo $(BUILD_DIR)/$(BINARY) -config config.yaml

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
