# Spectre guide

Detailed reference for developing, deploying, and operating Spectre. For a fast
start, see the [root README](../README.md).

## Contents

- [How it works](#how-it-works)
- [Development](#development)
- [The agent](#the-agent)
- [The server](#the-server)
- [Docker images](#docker-images)
- [Releases](#releases)
- [Protocol reference](#protocol-reference)

## How it works

The agent dials out to the server over WebSocket (works through NAT and firewalls). The browser connects to the server, which bridges terminal I/O. If **tmux** is installed on the remote machine, sessions persist across browser disconnects and network drops.

```
Browser ◄──── WebSocket ────► Server ◄──── WebSocket ────► Agent (+ tmux)
```

Two connection directions are supported:

- **Agent dials server** (inbound) — NAT-friendly, the default. The agent reaches out and registers.
- **Server dials agent** (outbound) — for agents directly reachable on the same LAN.

```
                                 ┌─────────────────┐
                                 │  Control Server  │
┌──────────┐    /terminal WS     │   (Node.js)      │
│  Browser  │ ◄────────────────► │                  │
│ (xterm.js)│                    └───────┬──┬───────┘
└──────────┘                             │  │
                              ┌──────────┘  └──────────┐
                              ▼ inbound                 ▼ outbound
                      ┌──────────────┐          ┌──────────────┐
                      │   Agent A    │          │   Agent B    │
                      │ behind NAT   │          │ on local LAN │
                      └──────────────┘          └──────────────┘
```

## Development

The `server` (API) and `web-ui` (web) live in a single **pnpm workspace**. The
`agent` is a separate Go module.

Prerequisites: **Node 20+**, **pnpm 11+**, and **Go 1.21+** (only for the agent).

```bash
pnpm install     # install workspace deps (once)
pnpm dev         # run the API (:8080) and web UI (:5173) together
```

Open `http://localhost:5173`. The web UI dev server proxies `/agents`, `/terminal`, `/auth`, `/devices`, and `/version` to the API on `:8080`, so there's no CORS setup.

### Root scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run server + web UI in parallel (preferred dev route) |
| `pnpm dev:server` | Run only the API (:8080) |
| `pnpm dev:web` | Run only the web UI (:5173) |
| `pnpm dev:agent` | Run the Go agent against `ws://localhost:8080` with auto-reload |
| `pnpm build` | Build every package |
| `pnpm test` | Test every package |
| `pnpm lint` | Type-check the web UI |

Target a single package directly with `pnpm --filter @spectre/server <script>` or `pnpm --filter @spectre/web-ui <script>`.

### The agent in development

The agent needs a running server. In one terminal run `pnpm dev`; in another:

```bash
pnpm dev:agent
# equivalent to: cd agent && AGENT_HOST=ws://localhost:8080 ./dev.sh
```

`agent/dev.sh` auto-reloads on file changes using `watchexec` or `entr` if available, otherwise it falls back to polling. It connects with the default legacy token (`changeme`), so the agent shows up in the web UI without enrollment.

### Docker Compose (alternative)

`pnpm dev` is the preferred route. If you'd rather run the server and web UI in containers:

```bash
docker compose -f compose.dev.yaml up -d --build   # server + web UI (built from source)
docker compose -f compose.dev.yaml logs -f server   # view logs
docker compose -f compose.dev.yaml down             # tear down
```

Web UI: `http://localhost:3000` | API: `http://localhost:8080`.

## The agent

The agent is a single self-contained Go binary. Getting it running is two steps: put the binary on the machine, then connect it to the server (usually as a background service).

### Install the binary

**Option A — install script (downloads the latest release):**

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash
```

**Option B — build it yourself and copy it over.** Useful when there is no published release, or the target is on your LAN (e.g. a home server). Match `GOOS`/`GOARCH` to the target machine:

```bash
# On your dev machine, from agent/:
GOOS=linux GOARCH=amd64 go build -o spectre-agent .
scp spectre-agent <user>@<remote>:/tmp/

# On the remote machine:
sudo install -m 0755 /tmp/spectre-agent /usr/local/bin/spectre-agent
```

| `GOOS` | `GOARCH` | Typical target |
|--------|----------|----------------|
| `linux` | `amd64` | Most servers, Intel/AMD NUCs |
| `linux` | `arm64` | Raspberry Pi (64-bit), ARM servers |
| `darwin` | `arm64` | Apple Silicon Mac |
| `windows` | `amd64` | Windows (`-o spectre-agent.exe`) |

### Connect to the server

**Agent dials server (inbound, NAT-friendly) — recommended.** Generate an enrollment token in the web UI, then:

```bash
sudo spectre-agent up --host wss://server.example.com --enroll <token>
```

The agent enrolls, stores a permanent device key, installs itself as a service, and starts. The enrollment token is one-time use; subsequent restarts reuse the stored key.

> Without `--enroll`, the agent falls back to a shared **legacy token** (`--token`, default `changeme`, which must match the server's `AGENT_AUTH_TOKEN`). That's fine for a quick LAN test but insecure for anything exposed — use enrollment and set a strong `AGENT_AUTH_TOKEN` instead.

**Server dials agent (outbound, same LAN).** When the agent machine is directly reachable, the server can dial it instead:

```bash
sudo spectre-agent up --listen :8081 --token mysecret
```

Then in the web UI, use the **Connect to agent** form with `ws://<agent-ip>:8081/ws` and the token.

> **TLS:** put a reverse proxy in front of the server and use `wss://` instead of `ws://`.

### Run as a daemon

`spectre-agent up` installs and starts a service that runs the agent in the background and restarts it automatically:

| | Linux (systemd) | macOS (launchd) |
|---|---|---|
| Service file | `/etc/systemd/system/spectre-agent.service` | `/Library/LaunchDaemons/com.spectre.agent.plist` |
| View logs | `journalctl -u spectre-agent -f` | `tail -f /var/log/spectre-agent.log` |
| Device data | `/var/lib/spectre-agent/` | `/var/lib/spectre-agent/` |

Enrollment (`--enroll`) is never written into the service file — the agent enrolls once, stores a device key, and reuses it on every restart.

> **No root / can't install a service?** Run the binary directly — it only writes to `~/.spectre-agent` and needs no privileges:
> ```bash
> setsid spectre-agent --host ws://<server-ip>:8080 >~/spectre-agent.log 2>&1 &
> ```
> It registers exactly like the service, and if tmux is installed sessions still persist. The only difference is it won't survive a reboot. (`nohup ... &` works too; plain `&` without `setsid`/`nohup` stops when you log out.)

### Commands and flags

```bash
spectre-agent status             # running state, pid, device id, service status
sudo spectre-agent up --host ... # install as a service and start
sudo spectre-agent down          # stop and remove the service
sudo spectre-agent down --purge  # also delete device key and data
spectre-agent                    # run in the foreground (Ctrl+C to stop)
```

| Flag | Default | Description |
|------|---------|-------------|
| `--host` | | Control server URL (`ws://` or `wss://`) |
| `--enroll` | | One-time enrollment token from the web UI |
| `--listen` | `:8081` | Address for the local WebSocket server (server-dials-agent) |
| `--token` | `changeme` | Legacy/outbound token the server must present |

### Uninstall

Full removal — stops the service and deletes the binary, data directories, and lock file:

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/uninstall-agent.sh | sudo bash
```

Or, if you only installed the service, remove it and its data (this leaves the binary in place):

```bash
sudo spectre-agent down --purge
```

If you ran the agent directly without installing a service (the no-root path above), there is no service to remove — just stop the process and delete its files:

```bash
pkill -f 'spectre-agent --host'          # stop the process
rm -f /usr/local/bin/spectre-agent       # or wherever you put it
rm -rf ~/.spectre-agent                  # device key and state
```

### Persistent sessions via tmux

When tmux is installed on the remote machine, the agent wraps each terminal in a tmux session named `spectre`. Close the tab and reopen it — you're back where you left off, and multiple tabs share the same session. This survives browser disconnects, WebSocket drops, and server restarts. Without tmux, sessions are ephemeral (lost on disconnect).

```bash
sudo apt install tmux    # Debian/Ubuntu
sudo yum install tmux    # RHEL/CentOS
brew install tmux        # macOS
```

### Data storage

- Device ID and key: `~/.spectre-agent/device-info.json` (or `/var/lib/spectre-agent/` when running as a service)
- Lock file: `/tmp/spectre-agent.lock` (prevents duplicate instances)

## The server

Node.js + TypeScript control plane that relays terminal sessions between browser clients and remote agents.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | *(empty)* | Web UI password. Empty = no auth |
| `PORT` | `8080` | HTTP/API port |
| `DATA_DIR` | `./data` | Persistent device store (JSON file) |
| `AGENT_AUTH_TOKEN` | `changeme` | Legacy shared token for agents connecting without enrollment |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (comma-separated) |

When `ADMIN_PASSWORD` is set, all API endpoints except `/auth/*` and `/version` require an `Authorization: Bearer <token>` header (obtained from `POST /auth/login`).

### HTTP API

| Endpoint | Description |
|----------|-------------|
| `GET /auth/status` | Returns `{ authEnabled: true/false }` |
| `POST /auth/login` | Body `{ "password": "..." }` → `{ "token": "..." }` |
| `GET /version` | Server version |
| `GET /agents` | List agents with status, system info, Docker containers |
| `POST /agents/connect` | Server dials an agent. Body `{ "address": "ws://ip:8081/ws", "token": "..." }` |
| `POST /agents/:id/command` | Push keystrokes. Body `{ "data": "ls\n" }` |
| `POST /agents/refresh-docker` | Re-fetch Docker info from all agents |
| `POST /agents/refresh-system` | Re-fetch system info from all agents |
| `POST /agents/refresh-network` | Re-fetch network info from all agents |
| `POST /devices/enroll` | Create an enrollment token → `{ "token": "...", "expiresAt": ... }` |
| `GET /devices` | List enrolled devices |

WebSocket endpoints:

| Path | Auth | Description |
|------|------|-------------|
| `WS /terminal?id=<agentId>` | UI session token | Browser terminal I/O |
| `WS /agents/events` | UI session token | Live agent status stream |
| `WS /agents/register` | Device key, enrollment token, or legacy token | Agent registration |

## Docker images

The `server` and `web-ui` images build from the **repo root** (the pnpm workspace and its single lockfile), not from their subdirectories:

```bash
docker build -f server/Dockerfile -t spectre-server .
docker build -f web-ui/Dockerfile -t spectre-web-ui .
```

The server image uses `pnpm deploy` to produce a self-contained, production-only `node_modules`; the web UI image builds the static bundle and serves it with nginx. A root `.dockerignore` keeps the build context small.

## Releases

Everything ships from **one tag**. Push a single `v*` tag (e.g. `v1.2.3`) and the `Release` workflow:

1. builds + pushes the **server** image to `ghcr.io/sidhantpanda/spectre/server`,
2. builds + pushes the **web-ui** image to `ghcr.io/sidhantpanda/spectre/web-ui`,
3. cross-compiles the **agent** binaries (linux/darwin, amd64/arm64), and
4. publishes a single **GitHub release** for the tag with the agent binaries attached.

```bash
git tag v1.2.3
git push origin v1.2.3
```

Images are tagged with the full version plus `major.minor`, `major`, `latest`, and the commit SHA. The install script (`install-agent.sh`) downloads the agent from the latest `v*` release.

Running the workflow manually (Actions tab → Release → *Run workflow*) builds all the same artifacts from the current commit — images tagged with the commit SHA — but does not publish a GitHub release or move the `latest` tag.

## Protocol reference

Messages are JSON. The agent speaks:

| Direction | Type | Description |
|-----------|------|-------------|
| Agent → Server | `hello` | Handshake with agent ID, fingerprint, version |
| Agent → Server | `output` | PTY output chunks |
| Agent → Server | `heartbeat` | Sent every 25s for liveness |
| Agent → Server | `dockerInfo` | Docker container list |
| Agent → Server | `systemInfo` | OS, CPU, memory, disk, tmuxAvailable |
| Agent → Server | `networkInfo` | IPv4/IPv6 addresses |
| Server → Agent | `hello` | Handshake response (with device key on enrollment) |
| Server → Agent | `keystroke` | Terminal input from browser |
| Server → Agent | `reset` | Attach to existing tmux session or start a new shell |
| Server → Agent | `dockerInfo` / `systemInfo` / `networkInfo` | Request the corresponding info |
