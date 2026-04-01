# Spectre

Remote terminal access from any browser. Access your machines from phones, tablets, or any device with a web browser.

![Spectre Control UI](public/control-server.png)

## What is Spectre?

Spectre lets you open a terminal on any of your machines from a web browser. It has three parts:

- **Control server** (Node.js) — relays terminal sessions between agents and browsers
- **Web UI** (React) — browser-based terminal with xterm.js, fleet dashboard
- **Agent** (Go) — lightweight binary that runs on each remote machine

Connections work in both directions: the agent can dial the server (for machines behind NAT), or the server can dial the agent (for machines on the local network).

## Quick start (production)

### 1. Deploy the control server

```bash
export ADMIN_PASSWORD=your-secure-password
docker compose up -d
```

Web UI: `http://localhost:3000` | API: `http://localhost:8080`

### 2. Install the agent on a remote machine

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash
```

### 3. Connect the agent

**Option A: Agent connects to server (best for NAT/firewalls)**

1. In the web UI, click **Generate Enrollment Token**
2. On the remote machine, run the command shown:

```bash
sudo spectre-agent up --host wss://<server-host> --enroll <token>
```

The agent enrolls (one-time), installs as a system service, and reconnects automatically.

**Option B: Server connects to agent (best for same LAN)**

1. On the remote machine:

```bash
sudo spectre-agent up --listen :8081 --token mysecret
```

2. In the web UI, enter `ws://<agent-ip>:8081/ws` and the token in the **Connect to agent** form.

Both options can be used at the same time on the same agent.

### 4. Open a terminal

Click any connected agent in the web UI. Works from any browser on any device.

## Local development

### Option 1: Docker Compose (easiest)

Build and run the server and web UI in containers, run the agent natively:

```bash
# Build and start the control server + web UI
docker compose -f compose.dev.yaml up -d --build

# Run the agent (connects to server on localhost)
cd agent
AGENT_HOST=ws://localhost:8080 ./dev.sh
```

Web UI: `http://localhost:3000` | API: `http://localhost:8080`

After making changes, rebuild the containers:

```bash
# Rebuild everything
docker compose -f compose.dev.yaml up -d --build

# Rebuild only the server
docker compose -f compose.dev.yaml up -d --build server

# Rebuild only the web UI
docker compose -f compose.dev.yaml up -d --build web-ui

# View logs
docker compose -f compose.dev.yaml logs -f server
docker compose -f compose.dev.yaml logs -f web-ui

# Tear down
docker compose -f compose.dev.yaml down
```

### Option 2: Run everything natively (hot reload)

Prerequisites: Node.js 20+, Go 1.21+

Start each component in a separate terminal:

```bash
# Terminal 1 — control server (port 8080, hot reload)
cd server
npm install
npm run dev

# Terminal 2 — web UI (port 5173, hot reload, proxies API to 8080)
cd web-ui
npm install
npm run dev

# Terminal 3 — agent (connects to server on localhost, auto-reload)
cd agent
AGENT_HOST=ws://localhost:8080 ./dev.sh
```

Web UI: `http://localhost:5173` (Vite dev server with HMR, proxies `/agents`, `/terminal`, `/auth`, `/devices`, `/version` to port 8080)

The agent `dev.sh` script auto-reloads on Go file changes (uses `watchexec` or `entr` if installed, falls back to polling).

To run the agent without the dev script:

```bash
cd agent
go run . --host ws://localhost:8080
```

### Running tests

```bash
cd server && npm test      # server unit tests
cd web-ui && npm test      # web UI tests
cd agent && go test ./...  # agent tests
```

### Building

**Server (Docker image):**

```bash
docker build -t spectre-server ./server
```

**Web UI (Docker image):**

```bash
docker build -t spectre-web-ui ./web-ui
```

**Agent (native binary):**

```bash
cd agent
go build -o spectre-agent .
```

Cross-compile for a different OS/arch:

```bash
GOOS=linux GOARCH=amd64 go build -o spectre-agent .
GOOS=linux GOARCH=arm64 go build -o spectre-agent .
GOOS=darwin GOARCH=arm64 go build -o spectre-agent .
```

### Dev command reference

| What | Command |
|------|---------|
| Start server + UI (Docker) | `docker compose -f compose.dev.yaml up -d --build` |
| Rebuild server (Docker) | `docker compose -f compose.dev.yaml up -d --build server` |
| Rebuild web UI (Docker) | `docker compose -f compose.dev.yaml up -d --build web-ui` |
| Server logs | `docker compose -f compose.dev.yaml logs -f server` |
| Tear down Docker | `docker compose -f compose.dev.yaml down` |
| Start server (native) | `cd server && npm run dev` |
| Start web UI (native) | `cd web-ui && npm run dev` |
| Start agent (dev) | `cd agent && AGENT_HOST=ws://localhost:8080 ./dev.sh` |
| Start agent (no reload) | `cd agent && go run . --host ws://localhost:8080` |
| Build agent binary | `cd agent && go build -o spectre-agent .` |
| Run all tests | `cd server && npm test && cd ../web-ui && npm test && cd ../agent && go test ./...` |

## Agent management

```bash
spectre-agent status          # show running state, device ID, enrollment
sudo spectre-agent up ...     # install and start as system service
sudo spectre-agent down       # stop and remove service (keeps device data)
sudo spectre-agent down --purge  # stop, remove service, delete all data
```

Full uninstall (binary + service + data):

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/uninstall-agent.sh | sudo bash
```

## Production deployment with TLS

Put a reverse proxy (nginx, Traefik, cloud LB) in front of the server and web UI to terminate TLS. The web UI container already runs nginx.

Forward HTTPS to server:8080 and web-ui:3000. Agents connect with `wss://`:

```bash
sudo spectre-agent up --host wss://spectre.example.com --enroll <token>
```

## Configuration

### Server environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `ADMIN_PASSWORD` | *(empty)* | Web UI login password. If empty, auth is disabled |
| `DATA_DIR` | `./data` | Persistent device store directory |
| `AGENT_AUTH_TOKEN` | `changeme` | Shared token for legacy agent auth |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |

### Agent flags

| Flag | Default | Description |
|------|---------|-------------|
| `--host` | | Control server URL (e.g. `wss://server.example.com`) |
| `--enroll` | | One-time enrollment token |
| `--listen` | `:8081` | Local API server address |
| `--token` | `changeme` | Token for server-to-agent connections |

## Architecture

```
                                 ┌─────────────────┐
                                 │  Control Server  │
                                 │   (Node.js)      │
┌──────────┐    /terminal WS     │                  │
│  Browser  │ ◄────────────────► │                  │
│ (xterm.js)│                    │                  │
└──────────┘                     └───────┬──┬───────┘
                                         │  │
                              ┌──────────┘  └──────────┐
                              │ inbound                 │ outbound
                              │ (agent dials server)    │ (server dials agent)
                              ▼                         ▼
                      ┌──────────────┐          ┌──────────────┐
                      │   Agent A    │          │   Agent B    │
                      │ behind NAT   │          │ on local LAN │
                      │  --host ...  │          │ --listen 8081│
                      └──────────────┘          └──────────────┘
```

**Inbound:** Agent dials `wss://server/agents/register` — works through NAT/firewalls. Uses enrollment tokens, then per-device keys.

**Outbound:** Server dials `ws://agent:8081/ws` — for directly reachable machines. Uses shared token auth.

Both directions can be active on the same agent simultaneously.
