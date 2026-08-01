#!/usr/bin/env bash
set -euo pipefail

# Downloads the agent build matching this machine and installs it. Given a
# --host, it also enrols the machine, so one pasted line takes a bare box to a
# connected one.
#
#   curl -fsSL .../install-agent.sh | sudo bash
#   curl -fsSL .../install-agent.sh | sudo bash -s -- --host wss://spectre.example.com --authkey sk_...

REPO="sidhantpanda/spectre"
TAG="${TAG:-}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
HOST="${SPECTRE_HOST:-}"
AUTHKEY="${SPECTRE_AUTHKEY:-}"

usage() {
  cat <<'EOF'
Install the Spectre agent.

Usage:
  install-agent.sh [--host <url>] [--authkey <key>] [--tag <vX.Y.Z>] [--bin-dir <dir>]

Options:
  --host <url>      Control server to enrol with, e.g. wss://spectre.example.com.
                    Omit to install the binary only.
  --authkey <key>   Auth key from the Spectre UI. With it, enrolment is
                    non-interactive; without it the agent prints a code to
                    approve in the web UI.
  --tag <vX.Y.Z>    Release to install. Defaults to the latest.
  --bin-dir <dir>   Where to put the binary. Defaults to /usr/local/bin.
  -h, --help        Show this help.

Environment:
  SPECTRE_HOST, SPECTRE_AUTHKEY, TAG, BIN_DIR are read when the matching flag
  is absent. Prefer SPECTRE_AUTHKEY over --authkey on shared machines: a flag
  is visible in `ps` to every user for as long as the command runs.

Examples:
  # Install only.
  curl -fsSL <url> | sudo bash

  # Install and connect in one line.
  curl -fsSL <url> | sudo bash -s -- --host wss://spectre.example.com --authkey sk_...

  # Same, keeping the key out of `ps`.
  curl -fsSL <url> | sudo SPECTRE_AUTHKEY=sk_... bash -s -- --host wss://spectre.example.com
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)     HOST="${2:-}";    shift 2 ;;
    --authkey)  AUTHKEY="${2:-}"; shift 2 ;;
    --tag)      TAG="${2:-}";     shift 2 ;;
    --bin-dir)  BIN_DIR="${2:-}"; shift 2 ;;
    --host=*)    HOST="${1#*=}";    shift ;;
    --authkey=*) AUTHKEY="${1#*=}"; shift ;;
    --tag=*)     TAG="${1#*=}";     shift ;;
    --bin-dir=*) BIN_DIR="${1#*=}"; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "error: unknown option: $1" >&2; echo "run with --help for usage" >&2; exit 1 ;;
  esac
done

if [[ -n "$AUTHKEY" && -z "$HOST" ]]; then
  echo "error: --authkey needs --host (the key says who you are; the host says where to go)" >&2
  exit 1
fi

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required" >&2; exit 1; }
}

require curl
require tar
require file

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
  tag=$(printf '%s' "$latest_json" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"v[0-9][^"}]*"' | head -n1 | sed 's/.*"\(v[0-9][^"]*\)"/\1/')
  if [[ -z "$tag" ]]; then
    echo "error: could not find latest v* release tag" >&2
    exit 1
  fi
  display_tag="$tag"
else
  tag="$TAG"
  display_tag="$TAG"
fi

asset_url="https://github.com/${REPO}/releases/download/${tag}/${asset_name}"

echo "Downloading ${asset_name} from release ${display_tag}..."
if ! curl -fL --retry 3 --retry-delay 2 "$asset_url" -o "$tmpdir/$asset_name"; then
  echo "error: no ${asset_name} in release ${display_tag}" >&2
  echo "       this machine is ${os}/${arch_norm}; check the release assets at" >&2
  echo "       https://github.com/${REPO}/releases/tag/${tag}" >&2
  exit 1
fi

tar -xzf "$tmpdir/$asset_name" -C "$tmpdir"

binary_path=""
while IFS= read -r f; do
  magic=$(file -b "$f")
  if printf '%s' "$magic" | grep -Eq '(ELF|Mach-O)'; then
    binary_path="$f"
    break
  fi
done < <(find "$tmpdir" -type f \( -name "spectre-agent" -o -name "spectre-agent-*" \) ! -name "*.tar.gz" ! -name "*.zip" | sort)

if [[ -z "$binary_path" ]]; then
  echo "error: executable binary not found after extraction" >&2
  exit 1
fi
chmod +x "$binary_path"

mkdir -p "$BIN_DIR"
install_path="$BIN_DIR/spectre-agent"
mv "$binary_path" "$install_path"

echo ""
echo "Installed spectre-agent to $install_path"

if [[ -z "$HOST" ]]; then
  echo ""
  echo "Next step — connect this machine to your Spectre server:"
  echo ""
  echo "  Approve it interactively (prints a code to approve in the web UI):"
  echo ""
  echo "     sudo spectre-agent up --host wss://<server-host>"
  echo ""
  echo "  Or with an auth key from the web UI (no interaction needed):"
  echo ""
  echo "     sudo spectre-agent up --host wss://<server-host> --authkey sk_..."
  echo ""
  echo "Useful commands:"
  echo "  spectre-agent status    Check if the agent is running"
  echo "  sudo spectre-agent down Stop and remove the service"
  echo "  spectre-agent --help    Show all options"
  exit 0
fi

# Enrolling installs a system service, which needs root. Checked here rather
# than at the top so that a plain install into a writable --bin-dir still works
# unprivileged.
if [[ "$(id -u)" -ne 0 ]]; then
  echo "error: enrolling needs root (it installs a system service); re-run with sudo" >&2
  exit 1
fi

echo ""
echo "Connecting to ${HOST}..."
echo ""

# The key goes through the environment, never the argument list: `up` reads
# $SPECTRE_AUTHKEY, and a flag would sit in `ps` for every user to read.
if [[ -n "$AUTHKEY" ]]; then
  SPECTRE_AUTHKEY="$AUTHKEY" "$install_path" up --host "$HOST"
else
  "$install_path" up --host "$HOST"
fi
