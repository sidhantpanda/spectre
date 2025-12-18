#!/bin/sh
set -eu

env_js_path="/usr/share/nginx/html/env.js"
api_base="${SPECTRE_SERVER_HOST:-}"
escaped_api_base="$(printf '%s' "$api_base" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

cat > "$env_js_path" <<EOF
window.__ENV = {
  SPECTRE_SERVER_HOST: "${escaped_api_base}"
};
EOF
