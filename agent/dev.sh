#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Development runner for the agent.
#
# The agent authenticates with a device key it earns by redeeming an auth key.
# Rather than special-casing auth for development, this mints a real auth key
# from the dev server (which runs with SPECTRE_DEV_NO_AUTH=1) so the dev loop
# exercises exactly the same enrollment path as production.

HOST_VALUE="${1:-${AGENT_HOST:-ws://localhost:8080}}"
HTTP_HOST="${HOST_VALUE/#ws:/http:}"
HTTP_HOST="${HTTP_HOST/#wss:/https:}"

AGENT_HOME="${SPECTRE_AGENT_HOME:-$HOME}"
DEVICE_FILE="$AGENT_HOME/.spectre-agent/device-info.json"

CMD=(go run . run --host "$HOST_VALUE")

if ! grep -q '"deviceKey"' "$DEVICE_FILE" 2>/dev/null; then
  echo "[dev] not enrolled yet; requesting an auth key from $HTTP_HOST"
  AUTHKEY=$(curl -fsS -X POST "$HTTP_HOST/api/authkeys" \
    -H 'Content-Type: application/json' \
    -d '{"reusable":true,"description":"local development"}' 2>/dev/null |
    sed -n 's/.*"key":"\([^"]*\)".*/\1/p') || true

  if [[ -z "${AUTHKEY:-}" ]]; then
    echo "[dev] could not get an auth key from $HTTP_HOST."
    echo "[dev] Is the dev server running? Start it with: pnpm dev"
    echo "[dev] Falling back to interactive approval."
  else
    CMD+=(--authkey "$AUTHKEY")
  fi
fi

if command -v watchexec >/dev/null 2>&1; then
  echo "[dev] watching Go files with watchexec (auto-reload enabled)"
  exec watchexec -r -e go -- "${CMD[@]}"
elif command -v entr >/dev/null 2>&1; then
  echo "[dev] watching Go files with entr (auto-reload enabled)"
  # entr needs -n when there is no TTY to read from.
  ENTR_FLAGS=(-r)
  [[ -t 0 ]] || ENTR_FLAGS+=(-n)
  find . -name '*.go' | entr "${ENTR_FLAGS[@]}" "${CMD[@]}"
  exit $?
fi

echo "[dev] no watcher (watchexec/entr) found; falling back to simple polling."

hash_files() {
  if command -v shasum >/dev/null 2>&1; then
    find . -name '*.go' -print0 | sort -z | xargs -0 shasum | shasum | awk '{print $1}'
  elif command -v md5 >/dev/null 2>&1; then
    find . -name '*.go' -print0 | sort -z | xargs -0 md5 | md5 | awk '{print $NF}'
  else
    find . -name '*.go' -printf '%T@ %p\n' | sort | awk '{print $1}' | tr '\n' ' ' | shasum | awk '{print $1}'
  fi
}

while true; do
  "${CMD[@]}" &
  pid=$!
  last_hash="$(hash_files)"
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1
    new_hash="$(hash_files)"
    if [[ "$new_hash" != "$last_hash" ]]; then
      echo "[dev] change detected, restarting agent..."
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      break
    fi
  done
done
