#!/bin/bash
# Installs the AluNotes stack (bridge + ai + web) on the host via systemd.
#
#   Bridge  — native Go binary (system-scope, runs as root for BT caps).
#   AI/Web  — run inside the distrobox (system-scope, run as $SERVICE_USER).
#
# Usage: ./deploy/install.sh   (will invoke sudo as needed)
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$DEPLOY_DIR")"
SERVICE_USER="${SUDO_USER:-$USER}"
SERVICE_UID="$(id -u "$SERVICE_USER")"
DISTROBOX_NAME="${DISTROBOX_NAME:-ubuntu24}"

GO_VERSION="1.24.7"
NODE_MAJOR="22"
PNPM_VERSION="10.33.0"

cyan() { printf '\033[36m==> %s\033[0m\n' "$*"; }
red()  { printf '\033[31merror: %s\033[0m\n' "$*" >&2; }

cyan "Project:        $PROJECT_DIR"
cyan "Service user:   $SERVICE_USER (uid $SERVICE_UID)"
cyan "Distrobox:      $DISTROBOX_NAME"

# ---------- Pre-flight ----------

if ! command -v distrobox >/dev/null 2>&1; then
  red "distrobox not found on host. Install it first."
  exit 1
fi
if ! distrobox list 2>/dev/null | awk -v n="$DISTROBOX_NAME" -F'|' 'NR>1 {gsub(/ /,"",$2); if ($2==n) f=1} END {exit !f}'; then
  red "distrobox '$DISTROBOX_NAME' not found. Create it with:"
  red "  distrobox create --name $DISTROBOX_NAME --image docker.io/library/ubuntu:24.04"
  exit 1
fi

# Wrapper so we can run commands inside the box as the service user.
box() { distrobox enter "$DISTROBOX_NAME" -- bash -lc "$*"; }

# ---------- 1. Build toolchain inside distrobox ----------

cyan "Installing build toolchain in $DISTROBOX_NAME"
box '
set -euxo pipefail
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates git pkg-config \
    ffmpeg libsndfile1 libsox-dev sox \
    python3 python3-venv python3-pip \
    inotify-tools

# Go '"$GO_VERSION"'
if ! /usr/local/go/bin/go version 2>/dev/null | grep -q "go'"$GO_VERSION"'"; then
    arch=$(dpkg --print-architecture)
    case "$arch" in
        amd64) gotar=go'"$GO_VERSION"'.linux-amd64.tar.gz ;;
        arm64) gotar=go'"$GO_VERSION"'.linux-arm64.tar.gz ;;
        *) echo "unsupported arch $arch" >&2; exit 1 ;;
    esac
    curl -fsSL "https://go.dev/dl/$gotar" -o /tmp/go.tgz
    sudo rm -rf /usr/local/go
    sudo tar -C /usr/local -xzf /tmp/go.tgz
    rm /tmp/go.tgz
fi

# Node '"$NODE_MAJOR"' + pnpm '"$PNPM_VERSION"'
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt '"$NODE_MAJOR"' ]; then
    curl -fsSL https://deb.nodesource.com/setup_'"$NODE_MAJOR"'.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
sudo corepack enable
sudo corepack prepare pnpm@'"$PNPM_VERSION"' --activate
'

# ---------- 2. Build the Go bridge ----------

cyan "Building bridge (CGO disabled → static binary)"
box "
set -euxo pipefail
export PATH=/usr/local/go/bin:\$PATH
cd '$PROJECT_DIR'
go mod tidy
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/alunotes-bridge ./cmd/bridge
"

cyan "Granting BT capabilities to bridge binary"
sudo setcap 'cap_net_raw,cap_net_admin+eip' "$PROJECT_DIR/bin/alunotes-bridge"

# ---------- 3. Install + build web ----------

cyan "Building web app"
box "
set -euxo pipefail
cd '$PROJECT_DIR/alunotes-bt-web'
pnpm install --frozen-lockfile
SKIP_ENV_VALIDATION=1 NEXT_TELEMETRY_DISABLED=1 pnpm build
"

# ---------- 4. Install AI venv ----------

cyan "Installing AI Python venv"
box "
set -euxo pipefail
cd '$PROJECT_DIR/alunotes-ai'
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -e '.[dev]'
"

# ---------- 5. Host-side setup ----------

cyan "Enabling user-session linger (needed for user-scope systemd services)"
sudo loginctl enable-linger "$SERVICE_USER"

cyan "Installing D-Bus policy for org.bluez calls"
sudo mkdir -p /etc/dbus-1/system.d
sudo install -m 0644 "$DEPLOY_DIR/dbus-alunotes.conf" /etc/dbus-1/system.d/alunotes-bridge.conf
sudo systemctl reload dbus || true

# ---------- 6. Install systemd units ----------

cyan "Installing systemd units"
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

UNITS=(
  alunotes-bt-rfkill.service
  alunotes-bridge.service
  alunotes-ai.service
  alunotes-web.service
)
for tpl in "${UNITS[@]}"; do
  sed \
    -e "s|@PROJECT_DIR@|$PROJECT_DIR|g" \
    -e "s|@SERVICE_USER@|$SERVICE_USER|g" \
    -e "s|@SERVICE_UID@|$SERVICE_UID|g" \
    -e "s|@DISTROBOX_NAME@|$DISTROBOX_NAME|g" \
    "$DEPLOY_DIR/$tpl" > "$TMPD/$tpl"
  sudo install -m 0644 "$TMPD/$tpl" "/etc/systemd/system/$tpl"
done

sudo systemctl daemon-reload
for svc in "${UNITS[@]}"; do
  sudo systemctl enable "$svc"
  sudo systemctl restart "$svc"
done

cyan "Done."
cat <<EOF

  Bridge  → http://localhost:8090   journalctl -u alunotes-bridge -f
  AI      → http://localhost:8100   journalctl -u alunotes-ai     -f
  Web     → http://localhost:3000   journalctl -u alunotes-web    -f
EOF
