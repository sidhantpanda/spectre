# Spectre

Remote terminal access from any browser. Access your machines from phones, tablets, or any device with a web browser.

- **server/** — Node.js + TypeScript control plane built with Express and `ws` that relays terminal sessions between agents and browsers.
- **web-ui/** — Vite + React + TypeScript UI with xterm.js for interactive terminal access and fleet management.
- **agent/** — Go-based agent that runs on remote machines. Connects to the control server and exposes a PTY-backed terminal.

Agents authenticate using per-device keys issued during enrollment. The web UI is protected by an admin password. TLS should be terminated at your reverse proxy (nginx, etc.) in front of the server.

![Spectre Control UI](public/control-server.png)

## Quick start

### 1. Deploy the control server

```bash
# Set your admin password (required for web UI auth)
export ADMIN_PASSWORD=your-secure-password

# Start with Docker Compose
docker compose up -d
```

The web UI is available at `http://localhost:3000` and the API at `http://localhost:8080`.

### 2. Enroll a remote machine

1. Open the web UI and sign in with your admin password
2. Click **Generate Enrollment Token** — you'll get a one-time command
3. On the remote machine, install the agent and run the enrollment command:

```bash
# Install the agent
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash

# Enroll with the control server (paste the command from the web UI)
sudo spectre-agent up --host ws://<control-server>:8080 --enroll <token>
```

After enrollment, the agent stores a unique device key and reconnects automatically. The enrollment token is single-use and expires in 15 minutes.

### 3. Access terminals

Click any connected agent in the web UI to open a terminal session. Works from any browser on any device.

## Production deployment with TLS

For production, terminate TLS at a reverse proxy (nginx, Traefik, cloud load balancer, etc.) in front of the control server and web UI. The web UI is already served by nginx inside its container.

Example: configure your reverse proxy to forward HTTPS traffic to the server on port 8080 and the web UI on port 3000 (or 80 inside the container). Agents should then connect using `wss://`:

```bash
sudo spectre-agent up --host wss://spectre.example.com --enroll <token>
```

The agent will warn if you use `ws://` instead of `wss://` in production.

## Agent installation

Releases include cross-compiled agents:
- Linux: `spectre-agent-linux-amd64.tar.gz`, `spectre-agent-linux-arm64.tar.gz`
- macOS: `spectre-agent-darwin-amd64.tar.gz`, `spectre-agent-darwin-arm64.tar.gz`
- Windows: `spectre-agent-windows-amd64.zip`, `spectre-agent-windows-arm64.zip`

One-liner installer (auto-detects OS/arch, fetches latest release):

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash
```

If you cannot use sudo:

```bash
BIN_DIR="$HOME/.local/bin" curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile
source ~/.profile
```

Uninstall (removes service + binary):

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/uninstall-agent.sh | sudo bash
```

### Running the agent as a service

```bash
# Enroll and start as a service (recommended)
sudo spectre-agent up --host wss://spectre.example.com --enroll <token>

# Stop and remove the service
sudo spectre-agent down
```

The `--enroll` flag is only needed on first run. After enrollment, the device key is stored in `~/.spectre-agent/device-info.json` and used automatically on restarts.

### Legacy token auth

For backward compatibility, agents can also connect with a shared token:

```bash
sudo spectre-agent up --host ws://<server>:8080 --token <shared-token>
```

Set `AGENT_AUTH_TOKEN` on the server to configure the shared token (default: `changeme`).

## Configuration

### Server environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `ADMIN_PASSWORD` | *(none)* | Password for web UI login. If empty, auth is disabled. |
| `DATA_DIR` | `./data` | Directory for persistent device store |
| `AGENT_AUTH_TOKEN` | `changeme` | Legacy shared token for agent auth |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (comma-separated) |

### Agent flags

| Flag | Default | Description |
|------|---------|-------------|
| `--listen` | `:8081` | Address for the local API server |
| `--host` | *(none)* | Control server URL to register with |
| `--enroll` | *(none)* | One-time enrollment token |
| `--token` | `changeme` | Token for outbound connections from the control server |

## Development

1. Start the control server:
   ```bash
   cd server
   npm install
   npm run dev
   ```
2. Start the web UI:
   ```bash
   cd web-ui
   npm install
   npm run dev
   ```
3. Run the agent:
   ```bash
   cd agent
   export AGENT_HOST=ws://localhost:8080
   ./dev.sh
   ```

Only one agent instance runs per machine; starting another prints the active PID and connection URL.

## Architecture

```
┌──────────┐     WebSocket      ┌─────────────────┐     WebSocket      ┌──────────┐
│  Browser  │ ◄──────────────► │  Control Server  │ ◄──────────────► │  Agent   │
│ (xterm.js)│    /terminal      │   (Node.js)      │  /agents/register │  (Go)    │
└──────────┘                    └─────────────────┘                    └──────────┘
                                       │
                                  ┌────┴────┐
                                  │  Store   │
                                  │ (JSON)   │
                                  └─────────┘
```

Agents dial out to the control server (NAT-friendly). The browser connects to the server which bridges terminal I/O. Device enrollment uses one-time tokens; subsequent connections use per-device keys.
