#!/bin/bash
# Install docker on the SteamOS host.
#
# SteamOS is Arch-based with /usr mounted read-only and atomic updates. The
# `docker` and `docker-compose` packages are in the `extra-3.7` repo, so we
# flip readonly off, install via pacman, flip it back on, and enable the
# daemon. Safe to re-run. Invoke directly on the host or, from inside the
# distrobox, via: `make host-install-docker`.
set -euo pipefail

SERVICE_USER="${SUDO_USER:-$USER}"

cyan() { printf '\033[36m==> %s\033[0m\n' "$*"; }
red()  { printf '\033[31merror: %s\033[0m\n' "$*" >&2; }

if [ -f /run/.containerenv ]; then
  red "this script must run on the host, not inside a distrobox/container"
  red "use 'make host-install-docker' from the repo root — it will hop to the host"
  exit 1
fi

if [ ! -f /etc/os-release ] || ! grep -q '^ID=steamos' /etc/os-release; then
  red "this installer only supports SteamOS. Install docker via your distro's package manager instead."
  exit 1
fi

# Already good?
if command -v docker >/dev/null 2>&1 \
   && systemctl is-enabled docker.service >/dev/null 2>&1 \
   && id -nG "$SERVICE_USER" | tr ' ' '\n' | grep -qx docker; then
  cyan "docker already installed, enabled, and $SERVICE_USER is in the docker group — nothing to do"
  systemctl is-active docker.service >/dev/null 2>&1 || sudo systemctl start docker.service
  exit 0
fi

cyan "Unlocking /usr (steamos-readonly disable)"
sudo steamos-readonly disable

# Initialize the pacman keyring if it has never been populated. On a fresh
# SteamOS the /etc/pacman.d/gnupg dir may be empty and pacman refuses to
# verify signatures.
if [ ! -s /etc/pacman.d/gnupg/pubring.gpg ]; then
  cyan "Initializing pacman keyring"
  sudo pacman-key --init
  sudo pacman-key --populate archlinux holo || sudo pacman-key --populate archlinux
fi

cyan "Installing docker + docker-compose"
sudo pacman -Sy --needed --noconfirm docker docker-compose

cyan "Relocking /usr (steamos-readonly enable)"
sudo steamos-readonly enable

cyan "Enabling and starting docker.service"
sudo systemctl enable --now docker.service

added_to_group=0
if ! id -nG "$SERVICE_USER" | tr ' ' '\n' | grep -qx docker; then
  cyan "Adding $SERVICE_USER to the docker group"
  sudo usermod -aG docker "$SERVICE_USER"
  added_to_group=1
fi

cyan "Done. Verify with: docker run --rm hello-world"
if [ "$added_to_group" = 1 ]; then
  printf '\033[33m==> Group change note: log out of the desktop session and back in\033[0m\n'
  printf '\033[33m    before using docker from inside the distrobox. host-spawn routes\033[0m\n'
  printf '\033[33m    through the user-session D-Bus, which does NOT pick up new groups\033[0m\n'
  printf '\033[33m    via newgrp or a fresh terminal alone. Quick one-off workaround:\033[0m\n'
  printf '\033[33m        sg docker -c '\''make build-all'\''\033[0m\n'
fi
cyan "Note: SteamOS atomic updates wipe /usr — you may need to re-run this after major updates."
