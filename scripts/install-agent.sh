#!/usr/bin/env bash
set -euo pipefail

REPO="sidhantpanda/spectre"
TAG="${TAG:-}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required" >&2; exit 1; }
}

require curl
require tar

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

if [[ -z "$TAG" ]]; then
  latest_json=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=20")
  tag=$(printf '%s' "$latest_json" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"agent-v[^"}]*"' | head -n1 | sed 's/.*"agent-v\([^"]*\)"/agent-v\1/')
  if [[ -z "$tag" ]]; then
    echo "error: could not find latest agent-v* release tag" >&2
    exit 1
  fi
  display_tag="$tag"
else
  tag="$TAG"
  display_tag="$TAG"
fi

asset_url="https://github.com/${REPO}/releases/download/${tag}/${asset_name}"

echo "Downloading ${asset_name} from release ${display_tag}..."
curl -fL --retry 3 --retry-delay 2 "$asset_url" -o "$tmpdir/$asset_name"

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
