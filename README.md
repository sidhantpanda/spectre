# Spectre

Remote terminal access from any browser. Open a shell on any of your machines from your phone, tablet, or someone else's computer.

![Spectre Control UI](public/control-server.png)

## Contents

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [The agent](#the-agent)
  - [Install the binary](#install-the-binary)
  - [Connect to the server](#connect-to-the-server)
  - [Run as a daemon](#run-as-a-daemon)
  - [Commands and flags](#commands-and-flags)
  - [Uninstall](#uninstall)
- [The server](#the-server)
  - [Configuration](#configuration)
  - [HTTP API](#http-api)
- [Local development](#local-development)
- [Releases](#releases)
- [Reference](#reference)

## How it works

The agent dials out to the server over WebSocket (works through NAT and firewalls). The browser connects to the server, which bridges terminal I/O. If **tmux** is installed on the remote machine, sessions persist across browser disconnects and network drops.

```
Browser ◄──── WebSocket ────► Server ◄──── WebSocket ────► Agent (+ tmux)
```

Two connection directions are supported:

- **Agent dials server** (inbound) — NAT-friendly, the default. The agent reaches out and registers.
- **Server dials agent** (outbound) — for agents directly reachable on the same LAN.

## Quick start

### 1. Start the server

On any machine with Docker, create a `compose.yaml`:

```yaml
services:
  server:
    image: ghcr.io/sidhantpanda/spectre/server:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - ADMIN_PASSWORD=changeme  # change this
    volumes:
      - server_data:/data

  web-ui:
    image: ghcr.io/sidhantpanda/spectre/web-ui:latest
    restart: unless-stopped
    ports:
      - "3000:80"
    environment:
      - SPECTRE_SERVER_HOST=http://localhost:8080

volumes:
  server_data:
```

```bash
docker compose up -d
```

Open `http://<server-ip>:3000` and log in with your password.

### 2. Install the agent on each remote machine

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash
sudo spectre-agent up --host ws://<server-ip>:8080
```

The machine appears in the web UI — click it to open a terminal. For anything beyond a quick LAN test, see [Connect to the server](#connect-to-the-server) for enrollment tokens and TLS.

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

## Local development

### Docker Compose (easiest)

```bash
docker compose -f compose.dev.yaml up -d --build     # server + web UI
cd agent && AGENT_HOST=ws://localhost:8080 ./dev.sh   # agent with auto-reload
```

Web UI: `http://localhost:3000` | API: `http://localhost:8080`

```bash
docker compose -f compose.dev.yaml up -d --build server   # rebuild server only
docker compose -f compose.dev.yaml up -d --build web-ui    # rebuild web UI only
docker compose -f compose.dev.yaml logs -f server          # view logs
docker compose -f compose.dev.yaml down                    # tear down
```

### Native (hot reload)

```bash
cd server  && npm install && npm run dev    # port 8080
cd web-ui  && npm install && npm run dev    # port 5173 (proxies to 8080)
cd agent   && AGENT_HOST=ws://localhost:8080 ./dev.sh
```

The agent dev script (`agent/dev.sh`) auto-reloads on file changes using `watchexec` or `entr` if available, otherwise it falls back to polling.

### Tests

```bash
cd server  && npm test
cd web-ui  && npm test
cd agent   && go test ./...
```

## Releases

Pushing a git tag triggers automated releases:

| Tag pattern | What happens |
|-------------|-------------|
| `server-v*` | Builds + pushes Docker image to `ghcr.io/sidhantpanda/spectre/server` |
| `web-ui-v*` | Builds + pushes Docker image to `ghcr.io/sidhantpanda/spectre/web-ui` |
| `agent-v*` | Cross-compiles agent binaries (linux/darwin/windows, amd64/arm64) and publishes to GitHub Releases |

Manual agent release: trigger the "Release Agent" workflow from the Actions tab. The install script (`install-agent.sh`) always downloads the latest `agent-v*` release.

## Reference

### Persistent sessions via tmux

When tmux is installed on the remote machine, the agent wraps each terminal in a tmux session named `spectre`. Close the tab and reopen it — you're back where you left off, and multiple tabs share the same session. This survives browser disconnects, WebSocket drops, and server restarts. Without tmux, sessions are ephemeral (lost on disconnect).

```bash
sudo apt install tmux    # Debian/Ubuntu
sudo yum install tmux    # RHEL/CentOS
brew install tmux        # macOS
```

### Agent data storage

- Device ID and key: `~/.spectre-agent/device-info.json` (or `/var/lib/spectre-agent/` when running as a service)
- Lock file: `/tmp/spectre-agent.lock` (prevents duplicate instances)

### WebSocket protocol

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

### Architecture

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
