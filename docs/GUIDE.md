# Spectre guide

Detailed reference for developing, deploying, and operating Spectre. For a fast
start, see the [root README](../README.md).

## Contents

- [How it works](#how-it-works)
- [Production checklist](#production-checklist)
- [Development](#development)
- [The agent](#the-agent)
- [The server](#the-server)
- [Docker images](#docker-images)
- [Releases](#releases)
- [Protocol reference](#protocol-reference)

## How it works

The agent dials out to the server over a WebSocket and **never listens on a port**. The browser connects to the server, and the server bridges terminal I/O between the two. If **tmux** is installed on the remote machine, sessions persist across browser disconnects and network drops.

```
┌───────────┐                   ┌─────────────────┐                         ┌───────────────┐
│  Browser  │ ◄──────────────►  │      Proxy      │  ◄────────────────────► │     Agent     │
│ (xterm.js)│   ticket auth     │     (nginx)     │   device key auth       │  (+ tmux) Go  │
└───────────┘                   └────────┬────────┘                         └───────────────┘
                                         │                                    dials out only,
                    /api/* ──────────────┼──────────────► Control Server      no open ports
                    /*     ──────────────┘                   (Node.js)
                                                                 │
                                                                 ▼
                                                            spectre.db
                                                  (devices, connections, hashed keys)
```

The proxy is the only published port. It routes `/api/*` to the control server
— `/api/terminal` and `/api/agents/events` for the browser, `/api/agents/register`
for agents — and everything else to the static web UI. Serving both from one
origin is why there is no CORS to configure and one place to terminate TLS.

Because the connection is always agent → server, Spectre works through NAT, CGNAT, and outbound-only firewalls, and there is no listening service to attack on the machines you connect to.

### Enrollment

A machine is only trusted once you say so. There are two ways to say it:

| | Auth key | Interactive approval |
|---|---|---|
| Command | `spectre-agent up --host … --authkey sk_…` | `spectre-agent up --host …` |
| Good for | scripts, cloud-init, golden images | adding a machine by hand |
| How it works | key is redeemed on connect and exchanged for a device key | agent prints a code; an admin approves it in the UI |
| Default lifetime | single use, 90 days | 15 minutes |

Both end in the same place: the machine holds a long-lived **device key**, and the enrollment credential is spent. The device key is stored `0600` on the machine and only ever as a hash on the server.

A machine waiting for interactive approval appears on the dashboard's machine list as soon as it asks — pushed over the dashboard's event socket, no reload — marked **Pending approval** with a yellow dot, and is approved or rejected from that row. (`/enroll` is still there for typing a code in by hand.) Once approved it becomes a real device row, yellow until its first connection lands, and red only after it has connected and then dropped.

## Production checklist

Spectre gives a browser a root shell. Before exposing it:

- [ ] **Set a real `ADMIN_PASSWORD`** (`openssl rand -base64 24`). The server refuses to start without one.
- [ ] **Terminate TLS** in front of the server and use `wss://` for agents. The supplied Compose file publishes only the proxy's port, so it is the single place to add TLS.
- [ ] **Never set `SPECTRE_DEV_NO_AUTH`.** It is refused outright when `NODE_ENV=production`.
- [ ] **Back up `DATA_DIR`.** Losing `spectre.db` means re-enrolling every machine.
- [ ] **Set `TRUST_PROXY=1` only if** a proxy you control sets `X-Forwarded-For`. Otherwise the login rate limiter can be bypassed by forging the header.
- [ ] **Revoke machines you no longer own** in the UI. Revocation kills the live session immediately.
- [ ] Prefer **single-use auth keys**. Reusable keys enrol unlimited machines until they expire or are revoked.

There is currently **one admin and no per-machine access control**: anyone with the password can shell into every enrolled machine.

## Development

The `server` (API) and `web-ui` live in a single **pnpm workspace**. The `agent` is a separate Go module.

Prerequisites: **Node 22+** (the server uses the built-in `node:sqlite`), **pnpm 11+**, and **Go 1.21+** (only for the agent).

```bash
pnpm install     # install workspace deps (once)
pnpm dev         # run the API (:8080) and web UI (:5173) together
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` to `:8080` — the same split the proxy container makes in production — so there's no CORS setup. `pnpm dev` sets `SPECTRE_DEV_NO_AUTH=1`, so there's no login screen in development.

### Root scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run server + web UI in parallel (preferred dev route) |
| `pnpm dev:server` | Run only the API (:8080) |
| `pnpm dev:web` | Run only the web UI (:5173) |
| `pnpm dev:agent` | Enrol and run the Go agent against `ws://localhost:8080` with auto-reload |
| `pnpm build` | Build every package |
| `pnpm test` | Test every package |
| `pnpm lint` | Type-check the web UI |

Target a single package with `pnpm --filter @spectre/server <script>` or `pnpm --filter @spectre/web-ui <script>`.

### The agent in development

The agent needs a running server. In one terminal run `pnpm dev`; in another:

```bash
pnpm dev:agent
```

`agent/dev.sh` mints an auth key from the dev server and enrols with it, so the dev loop exercises the same enrollment path as production. Once enrolled, the stored device key is reused on every restart. It auto-reloads on file changes using `watchexec` or `entr` if available, otherwise it polls.

To start over from an unenrolled state, delete `~/.spectre-agent`.

### Docker Compose (alternative)

`pnpm dev` is the faster inner loop. To test the built images:

```bash
docker compose -f compose.dev.yaml up -d --build
docker compose -f compose.dev.yaml logs -f server
docker compose -f compose.dev.yaml down
```

Web UI: `http://localhost:3000` — the proxy container, which also serves the API
under `/api` on that same origin. The `server` and `web-ui` containers publish
no ports of their own.

The proxy config is bind-mounted, so editing `default.conf.template` and
running `docker compose -f compose.dev.yaml restart proxy` picks it up — no
rebuild.

## The agent

A single self-contained Go binary. Put it on the machine, then enrol it.

### Install the binary

**Option A — install script (downloads the latest release).** It detects the machine's OS and architecture, picks the matching release asset, and installs to `/usr/local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash
```

Given a `--host` it enrols the machine too, so install and connect are one line:

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh \
  | sudo SPECTRE_AUTHKEY=sk_... bash -s -- --host wss://spectre.example.com
```

| Flag | Environment | Default | Purpose |
|------|-------------|---------|---------|
| `--host <url>` | `SPECTRE_HOST` | — | Control server to enrol with. Omit to install the binary only. |
| `--authkey <key>` | `SPECTRE_AUTHKEY` | — | Auth key from the UI. Omit and the agent prints a code to approve. |
| `--tag <vX.Y.Z>` | `TAG` | latest release | Which release to install. |
| `--bin-dir <dir>` | `BIN_DIR` | `/usr/local/bin` | Where to put the binary. |

Prefer `SPECTRE_AUTHKEY` over `--authkey`: a flag is visible in `ps` to every user on the machine for as long as the command runs. The script passes the key to the agent through the environment either way, so the agent's own process never exposes it.

Supported assets are `linux/amd64`, `linux/arm64`, `darwin/amd64`, and `darwin/arm64`. A 32-bit Pi (`armv7l`) has no published build — use Option B.

**Option B — build it here and copy it to a machine on your network.** This is the usual path for a home lab or LAN box: cross-compile on your dev machine, `scp` the binary over, and enrol it against your local server. No published release needed.

**1. Find the target's OS and architecture.** Go cross-compiles to a specific `GOOS`/`GOARCH` pair, so you need to know what the target machine is. If you can reach it, ask it:

```bash
ssh <user>@<remote> 'uname -sm'
# "Linux x86_64"   -> GOOS=linux  GOARCH=amd64
# "Linux aarch64"  -> GOOS=linux  GOARCH=arm64   (Raspberry Pi OS 64-bit, etc.)
# "Linux armv7l"   -> GOOS=linux  GOARCH=arm     (older 32-bit Pi)
# "Darwin arm64"   -> GOOS=darwin GOARCH=arm64   (Apple Silicon Mac)
# "Darwin x86_64"  -> GOOS=darwin GOARCH=amd64   (Intel Mac)
```

| `uname -sm` | `GOOS` | `GOARCH` | Typical target |
|-------------|--------|----------|----------------|
| `Linux x86_64` | `linux` | `amd64` | Most servers, Intel/AMD NUCs |
| `Linux aarch64` | `linux` | `arm64` | Raspberry Pi (64-bit), ARM servers |
| `Linux armv7l` / `armv6l` | `linux` | `arm` | Raspberry Pi (32-bit), older SBCs |
| `Darwin arm64` | `darwin` | `arm64` | Apple Silicon Mac |
| `Darwin x86_64` | `darwin` | `amd64` | Intel Mac |

**2. Build for that target.** From `agent/`:

```bash
cd agent
GOOS=linux GOARCH=arm64 go build -o spectre-agent .   # e.g. a 64-bit Raspberry Pi
```

`CGO_ENABLED=0` is the default here, so the binary is static and has no libc dependency — it runs on any machine of that arch, including minimal or musl-based distros.

**3. Copy it to the target and install it.** `scp` cannot write to `/usr/local/bin` directly (it's root-owned), so land it in a writable spot first, then move it into place:

```bash
scp spectre-agent <user>@<remote>:/tmp/

ssh <user>@<remote>
sudo install -m 0755 /tmp/spectre-agent /usr/local/bin/spectre-agent && rm /tmp/spectre-agent
```

**4. Enrol it against your server.** On the target, point `--host` at your control server. On a LAN without TLS that's plaintext `ws://` to the server's IP and the published proxy port; the agent appends `/api/agents/register` itself:

```bash
# Interactive — prints a code to approve in the web UI:
sudo spectre-agent up --host ws://<server-lan-ip>:3000

# Or with an auth key from the UI:
sudo spectre-agent up --host ws://<server-lan-ip>:3000 --authkey sk_...
```

> **`ws://` vs `wss://`:** a bare host or `wss://` uses TLS. Plaintext `ws://` to anything other than localhost logs a loud warning, because terminal I/O and the device key travel unencrypted. On a trusted home LAN that may be an acceptable trade-off; over the internet, always put the server behind a TLS proxy and use `wss://`.

To rebuild after pulling changes, repeat steps 2–3 — the installed binary is replaced in place and the stored device key in `~/.spectre-agent` (or `/var/lib/spectre-agent`) is reused, so there's no need to re-enrol.

### Enrol and run

```bash
# With an auth key from the UI (non-interactive):
sudo spectre-agent up --host wss://spectre.example.com --authkey sk_...

# Or interactively — prints a code to approve in the UI:
sudo spectre-agent up --host wss://spectre.example.com
```

`up` enrols the machine, stores the device key, installs a service, and starts it. The enrollment credential is never written into the service file: the agent enrols once, up front, and the service runs with only `--host`.

The key is written to the service's own state directory (`/var/lib/spectre-agent`, or `SPECTRE_AGENT_HOME` if you set it) and handed to the account the service runs as — the same place the service reads it from. A machine you had already enrolled by hand keeps its device key: `up` carries it over rather than enrolling the machine a second time.

> **TLS:** a bare host (`--host spectre.example.com`) defaults to `wss://`. Plaintext `ws://` to anything other than localhost logs a loud warning — terminal I/O and the device key would be exposed to the network.

### Run as a daemon

| | Linux (systemd) | macOS (launchd) |
|---|---|---|
| Service file | `/etc/systemd/system/spectre-agent.service` | `/Library/LaunchDaemons/com.spectre.agent.plist` |
| View logs | `journalctl -u spectre-agent -f` | `tail -f /var/log/spectre-agent.log` |
| Device data | `/var/lib/spectre-agent/` | `/var/lib/spectre-agent/` |

> **No root / can't install a service?** Run it directly — it only writes to `~/.spectre-agent` and needs no privileges:
> ```bash
> setsid spectre-agent run --host wss://spectre.example.com --authkey sk_... >~/spectre-agent.log 2>&1 &
> ```
> It enrols exactly like the service and tmux sessions still persist; it just won't survive a reboot.

### Commands and flags

```bash
spectre-agent status              # running state, pid, device id, service status
sudo spectre-agent up --host ...  # enrol, install as a service, and start
spectre-agent update              # upgrade to the latest release, in place
sudo spectre-agent down           # stop and remove the service
sudo spectre-agent down --purge   # also delete the device key
spectre-agent run --host ...      # run in the foreground (Ctrl+C to stop)
```

### Updating an agent

Two ways: from the dashboard, or on the machine itself.

**From the dashboard.** The control server checks GitHub hourly for the newest
agent release. Any connected machine running something else shows an
**Update to vX.Y.Z** button in the machine list. Clicking it sends the request
down that machine's existing socket; the agent downloads the release, swaps its
binary, and exits — systemd's `Restart=always` then starts it again on the new
build. The button reads *Updating…* until the machine reconnects reporting the
new version, which is the real confirmation it worked.

The agent exits rather than calling `systemctl restart` on itself: a service
restarting its own unit needs privileges the service account does not have, and
the exit achieves the same thing for free.

**Where the binary lives.** Replacing a running binary means `rename(2)` —
writing in place fails with `ETXTBSY` — and `rename` checks write permission on
the *directory*, not the file. A `sudo` install puts the binary in root-owned
`/usr/local/bin` but runs the service as the invoking user, which is exactly the
combination that cannot replace itself. So `up` moves the binary to
`/var/lib/spectre-agent/bin/spectre-agent`, hands that directory to the service
account, and leaves a symlink at the original path:

```
/usr/local/bin/spectre-agent -> /var/lib/spectre-agent/bin/spectre-agent
```

One binary, still on `PATH` under its usual name, and the CLI and the service
can never drift onto different versions. Nothing else about the host changes —
no extra units, no sudoers entries. A service already running as root, or one
whose binary sits somewhere it can already write, is left where it is.

`down --purge` deletes that state directory, so it copies the binary back to
its original path first rather than leaving a dangling symlink.

The button only appears on **connected** machines — the request travels over the
live socket, so an offline machine has nowhere to receive it. If the server
cannot reach GitHub, no button appears at all rather than a guess. A failed
update is reported back and shown on that machine's row, so it does not sit
spinning.

**On the machine.**

`spectre-agent update` asks GitHub for the newest release, downloads the build
for the machine's OS and architecture, replaces the binary in place, and
hands the running agent over to it — no sudo required.

```bash
spectre-agent update --check         # is there a newer release? changes nothing
spectre-agent update                 # install the latest
spectre-agent update --tag v1.2.3    # pin a version, or roll back
spectre-agent update --force         # reinstall the version already running
```

**It does not re-enrol.** The device key lives in the agent's state directory,
which the update never touches, so the machine keeps its identity and needs no
new auth key — it reconnects as the same device it already was.

Notes:

- **Neither kind of update needs root.** `up` has already put the binary
  somewhere the service account owns (see *Where the binary lives* above), and
  the restart is a signal, not a `systemctl` call: the CLI sends `SIGTERM` to
  the running agent, which shuts down cleanly, and `Restart=always` starts the
  new binary. Both the CLI and the control server take that route.
- If the binary *is* somewhere you cannot write — a stock install where the
  service runs as root — the command stops before downloading anything and
  tells you to re-run with sudo.
- The downloaded binary is run once before it is installed. A truncated
  download or a wrong-architecture asset fails there, leaving the working
  binary in place.
- The swap is a rename within one directory, so it is atomic — an interrupted
  update never leaves a half-written agent behind. Replacing the file of a
  running process is safe on Linux and macOS; the old process keeps running
  until the service restarts.
- Unauthenticated GitHub API calls are rate-limited per IP (60/hour). If you
  hit that, pass `--tag` to skip the lookup.

| Flag | Description |
|------|-------------|
| `--host` | Control server URL. Required. `wss://host` (or a bare host, which defaults to TLS) |
| `--authkey` | Auth key from the UI. Omit to approve the machine interactively |

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/uninstall-agent.sh | sudo bash
```

Or, to remove just the service and its data (leaving the binary):

```bash
sudo spectre-agent down --purge
```

`down` leaves the binary in place. Delete it when you're done: `sudo rm /usr/local/bin/spectre-agent`.

Revoking the machine in the web UI is what actually cuts off access — uninstalling only stops the agent from reconnecting.

### Persistent sessions via tmux

When tmux is installed, the agent wraps each terminal in a tmux session named `spectre`. Close the tab and reopen it and you're back where you left off; multiple tabs share the session. This survives browser disconnects, WebSocket drops, and server restarts. Without tmux, sessions are ephemeral.

```bash
sudo apt install tmux    # Debian/Ubuntu
sudo yum install tmux    # RHEL/CentOS
brew install tmux        # macOS
```

### Data storage

- Device ID and key: `~/.spectre-agent/device-info.json`, mode `0600` (or `/var/lib/spectre-agent/` as a service)
- Lock file: `/tmp/spectre-agent.lock` (prevents duplicate instances; contains no secrets)

## The server

Node.js + TypeScript control plane that relays terminal sessions between browsers and agents.

### Configuration

The server loads the nearest `.env` file automatically (searching upward from its working directory), so a repo-root `.env` works whether you start from the root or from `server/`. Values already set in the environment take precedence over the file.

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | *(none)* | **Required.** Web UI password, min 12 chars in production. Setting it turns authentication on; the server refuses to start without it unless `SPECTRE_DEV_NO_AUTH=1` |
| `SPECTRE_DEV_NO_AUTH` | | Set to `1` to let the server start with **no** password (auth off) for local development. Ignored when `ADMIN_PASSWORD` is set — a password always means auth is on. Fatal when `NODE_ENV=production` |
| `SPECTRE_PUBLIC_HOST` | *(auto)* | Address agents should dial, shown in the UI's enrollment command, e.g. `wss://spectre.example.com`. When unset and `TRUST_PROXY=1`, the UI advertises the origin the browser reached the proxy on; otherwise the server's detected LAN address and `PORT` |
| `PORT` | `8080` | HTTP/API port. Everything is served under `/api` |
| `DATA_DIR` | `./data` | SQLite database location (`spectre.db`, written `0600`) |
| `CORS_ORIGIN` | *(empty)* | Comma-separated allowed origins. Empty = no cross-origin access |
| `TRUST_PROXY` | | Set to `1` only behind a proxy that sets `X-Forwarded-For` and `X-Forwarded-Proto`. The supplied proxy container does both |
| `SPECTRE_DEBUG_TERMINAL` | | Set to `1` to log terminal output summaries. Off by default: output contains what the user typed |

Authentication is on exactly when `ADMIN_PASSWORD` is set, so its state is consistent across page loads. `SPECTRE_DEV_NO_AUTH` only permits running without a password; it never overrides one.

### Authentication

- **Browser → server:** `POST /api/auth/login` with the password returns a session token, sent as `Authorization: Bearer <token>`. Sessions idle out after 24h and expire absolutely after 7 days. Repeated failed logins lock out the client.
- **Browser → WebSocket:** browsers can't set headers on a WebSocket handshake, so the session is exchanged via `POST /api/auth/ws-ticket` for a single-use ticket valid for 30 seconds, passed as `?ticket=`. Session tokens are never accepted in a URL.
- **Agent → server:** `Authorization: Bearer <device key | auth key>` on the handshake. Agents are authenticated before the WebSocket is established.

### HTTP API

Public:

| Endpoint | Description |
|----------|-------------|
| `GET /api/healthz` | Liveness probe |
| `GET /api/version` | Server version |
| `GET /api/auth/status` | `{ authEnabled: true/false }` |
| `POST /api/auth/login` | `{ "password": "..." }` → `{ "token": "..." }`. Rate limited |
| `POST /api/devices/approval-request` | Agent asks to be approved → `{ userCode, pollToken, expiresAt }`. Rate limited |
| `POST /api/devices/approval-poll` | Agent polls → `{ status: "pending" \| "approved" \| "expired", deviceKey? }`. Rate limited |

Requires `Authorization: Bearer <session token>`:

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/logout` | Invalidate the current session |
| `POST /api/auth/ws-ticket` | → `{ ticket }` for a WebSocket upgrade |
| `GET /api/agents` | List agents with status, system info, Docker containers |
| `POST /api/agents/:id/command` | Push keystrokes. `{ "data": "ls\n" }` |
| `POST /api/agents/refresh-docker` \| `-system` \| `-network` | Re-fetch info from all agents |
| `POST /api/agents/:id/update` | Ask a connected machine to upgrade itself. `{ version? }`, defaulting to the latest release. `409` when the machine is offline |
| `POST /api/authkeys` | Create an auth key. `{ reusable?, expiresInMs?, description? }` → `{ key, ... }`. **The plaintext key is returned only here** |
| `GET /api/authkeys` | List auth keys (hints only, never the key) |
| `DELETE /api/authkeys/:id` | Revoke an auth key |
| `GET /api/devices` | List enrolled devices (one per physical machine). Never includes key material |
| `GET /api/devices/:id/connections` | Connection history for a device |
| `DELETE /api/devices/:id` | Revoke a device and drop its live connections |
| `GET /api/devices/pending` | Machines waiting for approval |
| `POST /api/devices/pending/:userCode/approve` | Approve a machine. `{ name? }` |
| `POST /api/devices/pending/:userCode/deny` | Deny and discard the request |

WebSocket:

| Path | Auth | Description |
|------|------|-------------|
| `WS /api/terminal?id=<agentId>&ticket=<t>` | Single-use ticket | Browser terminal I/O |
| `WS /api/agents/events?ticket=<t>` | Single-use ticket | Live agent status stream |
| `WS /api/agents/register` | `Authorization: Bearer <device key \| auth key>` | Agent registration |

### Device store

State lives in a SQLite database (`spectre.db` in `DATA_DIR`, via Node's built-in `node:sqlite`, written `0600`): enrolled devices and their last-known state, auth keys, pending approvals, and a connection history. All credentials are stored as **SHA-256 hashes** — reading the file is not enough to impersonate a device or enrol a new one. These are high-entropy random tokens rather than passwords, so a fast hash is appropriate; there is nothing to brute-force. A pre-existing `store.json` from an earlier version is imported once on first start and renamed to `store.json.imported`.

**Device identity.** A device is keyed by a stable hardware identity derived from what the agent reports — the Linux machine-id if present, otherwise its set of MAC addresses, otherwise the agent's persistent device id. This is why a machine that disconnects and reconnects — or is re-enrolled with a new key — stays a single row that flips between `connected` and `disconnected`, rather than appearing twice.

## Docker images

Spectre builds two images. Both build from the **repo root** (the pnpm workspace and its single lockfile), not from their subdirectories:

```bash
docker build -f server/Dockerfile -t spectre-server .
docker build -f web-ui/Dockerfile -t spectre-web-ui .
```

The server image uses `pnpm deploy` to produce a self-contained production-only `node_modules`. The web UI image builds the static bundle and serves it with nginx — static files only, no proxying.

**The proxy is stock `nginx:1.29.4-alpine`** — there is nothing to build or publish. Compose mounts `default.conf.template` at `/etc/nginx/templates/`, and the image's own entrypoint runs `envsubst` over it at start, writing `/etc/nginx/conf.d/default.conf`. Two variables are filled in:

| Variable | Default | Meaning |
|----------|---------|---------|
| `SPECTRE_SERVER_UPSTREAM` | `server:8080` | Where `/api/*` goes |
| `SPECTRE_WEB_UI_UPSTREAM` | `web-ui:80` | Where everything else goes |

`NGINX_ENVSUBST_FILTER=^SPECTRE_` keeps envsubst off nginx's own runtime variables (`$host`, `$http_upgrade`, …), which would otherwise be blanked out. The proxy is the only container that publishes a port, which is why no CORS configuration is needed and there is a single place to terminate TLS.

## Releases

Everything ships from **one tag**. Push a `v*` tag (e.g. `v1.2.3`) and the `Release` workflow:

1. builds + pushes the **server** image to `ghcr.io/sidhantpanda/spectre/server`,
2. builds + pushes the **web-ui** image to `ghcr.io/sidhantpanda/spectre/web-ui`,
3. cross-compiles the **agent** binaries (linux/darwin, amd64/arm64), and
4. publishes a **GitHub release** for the tag with the agent binaries attached.

The proxy is stock nginx, so no third image is built or released.

```bash
git tag v1.2.3
git push origin v1.2.3
```

Images are tagged with the full version plus `major.minor`, `major`, `latest`, and the commit SHA. The install script downloads the agent from the latest `v*` release.

> The release does not yet publish checksums, and `install-agent.sh` does not verify the download. Anyone who can tamper with the release assets or the connection can run code as root on machines that install the agent. This is the top open item before a wide release.

Running the workflow manually (Actions tab → Release → *Run workflow*) builds the same artifacts from the current commit, tagged with the SHA, without publishing a release or moving `latest`.

## Protocol reference

Messages are JSON.

| Direction | Type | Description |
|-----------|------|-------------|
| Agent → Server | `hello` | Handshake with device ID, fingerprint, version |
| Agent → Server | `output` | PTY output chunks |
| Agent → Server | `heartbeat` | Sent every 25s for liveness |
| Agent → Server | `dockerInfo` | Docker container list |
| Agent → Server | `systemInfo` | OS, CPU, memory, disk, tmuxAvailable |
| Agent → Server | `networkInfo` | IPv4/IPv6 addresses |
| Server → Agent | `hello` | Handshake response |
| Server → Agent | `enrolled` | Issues the device key after an auth key is redeemed |
| Server → Agent | `keystroke` | Terminal input from the browser |
| Server → Agent | `reset` | Attach to an existing tmux session or start a shell |
| Server → Agent | `dockerInfo` / `systemInfo` / `networkInfo` | Request the corresponding info |

The server drops agent messages larger than 256 KB and browser messages larger than 64 KB.
