# Spectre

Remote terminal access from any browser. Open a shell on any of your machines from your phone, tablet, or someone else's computer.

![Spectre Control UI](public/control-server.png)

## Setup

### Step 1: Start the server

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

### Step 2: Install the agent on each remote machine

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash
sudo spectre-agent up --host ws://<server-ip>:8080
```

That's it. The machine appears in the web UI. Click it to open a terminal.

> For TLS, put a reverse proxy in front and use `wss://` instead of `ws://`.

## How it works

The agent dials out to the server over WebSocket (works through NAT and firewalls). The browser connects to the server which bridges terminal I/O. If **tmux** is installed on the remote machine, sessions persist across browser disconnects and network drops.

```
Browser ◄──── WebSocket ────► Server ◄──── WebSocket ────► Agent (+ tmux)
```

## Persistent sessions

If tmux is installed on the remote machine, Spectre wraps the terminal in a persistent tmux session. Close the tab, reopen it -- you're back where you left off. Multiple tabs share the same session.

```bash
sudo apt install tmux    # Debian/Ubuntu
sudo yum install tmux    # RHEL/CentOS
brew install tmux        # macOS
```

Without tmux, sessions are ephemeral (lost on disconnect).

## Agent commands

```bash
spectre-agent status             # check if running
sudo spectre-agent up --host ... # install as service and start
sudo spectre-agent down          # stop and remove service
sudo spectre-agent down --purge  # also delete device data
```

Uninstall everything:

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/uninstall-agent.sh | sudo bash
```

## Server connects to agent (alternative)

If the agent is directly reachable (same LAN, no NAT), the server can dial the agent instead:

```bash
sudo spectre-agent up --listen :8081 --token mysecret
```

Then in the web UI, use the **Connect to agent** form with `ws://<agent-ip>:8081/ws` and the token.

## Configuration

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | *(empty)* | Web UI password. Empty = no auth |
| `PORT` | `8080` | API port |
| `DATA_DIR` | `./data` | Persistent store |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |

### Agent

| Flag | Default | Description |
|------|---------|-------------|
| `--host` | | Server URL (`ws://` or `wss://`) |
| `--listen` | `:8081` | Local API address |
| `--token` | `changeme` | Token for server-to-agent connections |
| `--enroll` | | One-time enrollment token |

## Releases

Pushing a git tag triggers automated releases:

| Tag pattern | What happens |
|-------------|-------------|
| `server-v*` | Builds + pushes Docker image to `ghcr.io/sidhantpanda/spectre/server` |
| `web-ui-v*` | Builds + pushes Docker image to `ghcr.io/sidhantpanda/spectre/web-ui` |
| `agent-v*` | Cross-compiles agent binaries (linux/darwin, amd64/arm64) and publishes to GitHub Releases |

Manual agent release: trigger the "Release Agent" workflow from the Actions tab.

The install script (`install-agent.sh`) automatically downloads the latest `agent-v*` release.

## Local development

### Docker Compose (easiest)

```bash
docker compose -f compose.dev.yaml up -d --build    # server + web UI
cd agent && AGENT_HOST=ws://localhost:8080 ./dev.sh  # agent with auto-reload
```

Web UI: `http://localhost:3000` | API: `http://localhost:8080`

```bash
docker compose -f compose.dev.yaml up -d --build server   # rebuild server only
docker compose -f compose.dev.yaml up -d --build web-ui   # rebuild web UI only
docker compose -f compose.dev.yaml logs -f server          # view logs
docker compose -f compose.dev.yaml down                    # tear down
```

### Native (hot reload)

```bash
cd server  && npm install && npm run dev           # port 8080
cd web-ui  && npm install && npm run dev           # port 5173 (proxies to 8080)
cd agent   && AGENT_HOST=ws://localhost:8080 ./dev.sh
```

### Build agent binary

```bash
cd agent && go build -o spectre-agent .
GOOS=linux GOARCH=arm64 go build -o spectre-agent .  # cross-compile
```

### Tests

```bash
cd server  && npm test
cd web-ui  && npm test
cd agent   && go test ./...
```

## Architecture

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
