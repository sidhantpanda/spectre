#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="${BIN_DIR:-/usr/local/bin}"
UNIT_PATH="/etc/systemd/system/spectre-agent.service"
PLIST_PATH="/Library/LaunchDaemons/com.spectre.agent.plist"
LABEL="com.spectre.agent"

log() { printf '%s\n' "$*"; }

stop_systemd() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now spectre-agent.service 2>/dev/null || true
    rm -f "$UNIT_PATH"
    systemctl daemon-reload 2>/dev/null || true
    log "Removed systemd service"
  fi
}

stop_launchd() {
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "system/${LABEL}" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    log "Removed launchd service"
  fi
}

remove_binary() {
  local path="$BIN_DIR/spectre-agent"
  if [[ -f "$path" ]]; then
    rm -f "$path"
    log "Removed $path"
  else
    log "Binary not found at $path (skipped)"
  fi
}

remove_data() {
  local dirs=(
    "/var/lib/spectre-agent"
    "$HOME/.spectre-agent"
  )

  # Also check SUDO_USER's home if running with sudo
  if [[ -n "${SUDO_USER:-}" ]]; then
    local sudo_home
    sudo_home=$(eval echo "~$SUDO_USER") 2>/dev/null || true
    if [[ -n "$sudo_home" && "$sudo_home" != "$HOME" ]]; then
      dirs+=("$sudo_home/.spectre-agent")
    fi
  fi

  for dir in "${dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      rm -rf "$dir"
      log "Removed data directory $dir"
    fi
  done

  # Clean up lock file
  local lockfile="/tmp/spectre-agent.lock"
  if [[ -f "$lockfile" ]]; then
    rm -f "$lockfile"
    log "Removed lock file"
  fi
}

stop_systemd
stop_launchd
remove_binary
remove_data

log ""
log "Uninstall complete."
log "If you installed to a custom BIN_DIR, rerun with: BIN_DIR=<dir> $0"
