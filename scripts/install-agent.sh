#!/usr/bin/env bash
set -euo pipefail

REPO="sidhantpanda/spectre"
TAG="${TAG:-}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
PY_BIN=""

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required" >&2; exit 1; }
}

require curl
require tar

if command -v python3 >/dev/null 2>&1; then
  PY_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PY_BIN="python"
else
  echo "error: python is required" >&2
  exit 1
fi

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)

case "$os" in
  linux|darwin) ;;
  *) echo "error: unsupported OS: $os" >&2; exit 1;;
esac

case "$arch" in
  x86_64|amd64) arch_norm=amd64 ;;
  aarch64|arm64) arch_norm=arm64 ;;
  *) echo "error: unsupported arch: $arch" >&2; exit 1;;
esac

asset_name="spectre-agent-${os}-${arch_norm}.tar.gz"

tmpdir=$(mktemp -d)
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

fetch_release() {
  local url="https://api.github.com/repos/${REPO}/releases/${1}"
  curl -fsSL "$url"
}

json_file="$tmpdir/release.json"
if [[ -z "$TAG" ]]; then
  fetch_release latest > "$json_file"
else
  fetch_release "tags/${TAG}" > "$json_file"
fi

read -r tag asset_url < <("$PY_BIN" <<'PY' "$json_file" "$asset_name"
import json, sys
json_path, asset_name = sys.argv[1:3]
with open(json_path, "r", encoding="utf-8") as fh:
    data = json.load(fh)
tag = data.get("tag_name", "")
url = None
for asset in data.get("assets", []):
    if asset.get("name") == asset_name:
        url = asset.get("browser_download_url")
        break
if not tag or not url:
    sys.exit(1)
print(tag)
print(url)
PY
) || { echo "error: failed to find asset ${asset_name} (tag=${TAG:-latest})" >&2; exit 1; }

echo "Downloading ${asset_name} from release ${tag}..."
curl -fsSL "$asset_url" -o "$tmpdir/$asset_name"

tar -xzf "$tmpdir/$asset_name" -C "$tmpdir"

binary_path=$(find "$tmpdir" -maxdepth 1 -type f -name "spectre-agent-*" | head -n1)
if [[ -z "$binary_path" ]]; then
  echo "error: binary not found after extraction" >&2
  exit 1
fi
chmod +x "$binary_path"

mkdir -p "$BIN_DIR"
install_path="$BIN_DIR/spectre-agent"
mv "$binary_path" "$install_path"

echo "Installed spectre-agent to $install_path"
echo "Add to PATH if needed: export PATH=\"$BIN_DIR:$PATH\""
echo "Run: sudo spectre-agent up -token <token> -host ws://<control-server-host>:8080/agents/register"
