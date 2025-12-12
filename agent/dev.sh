#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

CMD=(go run .)
if [[ -n "${AGENT_HOST:-}" ]]; then
  CMD+=(-host "$AGENT_HOST")
fi

if command -v watchexec >/dev/null 2>&1; then
  echo "[dev] watching Go files with watchexec (auto-reload enabled)"
  exec watchexec -r -e go -- "${CMD[@]}"
elif command -v entr >/dev/null 2>&1; then
  echo "[dev] watching Go files with entr (auto-reload enabled)"
  # entr reads a list of files from stdin
  find . -name '*.go' | entr -r "${CMD[@]}"
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
