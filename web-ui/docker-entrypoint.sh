#!/bin/sh
set -eu

# SPECTRE_SERVER_HOST is normally left empty: the proxy in front of this
# container serves the API under /api on this same origin, so the browser just
# uses window.location.origin. Set it only when the API is genuinely served
# from another origin, in which case that origin must also be listed in the
# server's CORS_ORIGIN.
env_js_path="/usr/share/nginx/html/env.js"
api_base="${SPECTRE_SERVER_HOST:-}"
escaped_api_base="$(printf '%s' "$api_base" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
ui_version="${SPECTRE_WEB_UI_VERSION:-}"
escaped_ui_version="$(printf '%s' "$ui_version" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

cat > "$env_js_path" <<EOF
window.__ENV = {
  SPECTRE_SERVER_HOST: "${escaped_api_base}",
  SPECTRE_WEB_UI_VERSION: "${escaped_ui_version}"
};
EOF
