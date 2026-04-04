#!/bin/bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$DEPLOY_DIR")"

echo "==> Installing systemd services from $DEPLOY_DIR"

# Install system dependencies
echo "==> Installing dependencies..."
cd "$PROJECT_DIR"
make deps

# Build the Go binary
echo "==> Building alunotes-bridge..."
make build

# Build the Next.js app
echo "==> Building web app..."
cd "$PROJECT_DIR/alunotes-bt-web"
pnpm build

# Copy service files
echo "==> Installing service files..."
sudo cp "$DEPLOY_DIR/alunotes-bt-rfkill.service" /etc/systemd/system/
sudo cp "$DEPLOY_DIR/alunotes-bridge.service" /etc/systemd/system/
sudo cp "$DEPLOY_DIR/alunotes-web.service" /etc/systemd/system/

# Reload and enable
echo "==> Enabling services..."
sudo systemctl daemon-reload
sudo systemctl enable alunotes-bt-rfkill.service
sudo systemctl enable alunotes-bridge.service
sudo systemctl enable alunotes-web.service

echo "==> Starting services..."
sudo systemctl start alunotes-bt-rfkill.service
sudo systemctl start alunotes-bridge.service
sudo systemctl start alunotes-web.service

echo ""
echo "Done! Services installed and running."
echo "  Bridge:  sudo systemctl status alunotes-bridge"
echo "  Web UI:  sudo systemctl status alunotes-web"
echo "  Logs:    journalctl -u alunotes-bridge -f"
echo "           journalctl -u alunotes-web -f"
