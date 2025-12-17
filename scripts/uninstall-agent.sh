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
  fi
}

stop_launchd() {
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "system/${LABEL}" 2>/dev/null || true
    rm -f "$PLIST_PATH"
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

stop_systemd
stop_launchd
remove_binary

log "Uninstall complete. If you changed BIN_DIR during install, rerun with BIN_DIR=<dir>."