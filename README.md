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
export ADMIN_PASSWORD=your-secure-password
docker compose up -d
```

The web UI is at `http://localhost:3000`, the API at `http://localhost:8080`.

### 2. Install the agent on a remote machine

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash
```

This downloads the latest release binary and installs it to `/usr/local/bin/spectre-agent`.

If you cannot use sudo, install to a writable directory:

```bash
BIN_DIR="$HOME/.local/bin" curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile && source ~/.profile
```

### 3. Connect the agent

There are two ways to connect an agent. You can use either or both at the same time.

#### Option A: Agent connects to server (inbound)

Best for machines behind NAT or firewalls. The agent dials out to the control server.

1. In the web UI, click **Generate Enrollment Token** to get a one-time command
2. On the remote machine:

```bash
sudo spectre-agent up --host wss://<server-host> --enroll <token>
```

This enrolls the agent (exchanges the token for a permanent device key), installs it as a system service, and starts it. The enrollment token is single-use and expires in 15 minutes. After enrollment, the agent reconnects automatically using the stored device key.

#### Option B: Server connects to agent (outbound)

Best when the agent machine is directly reachable on the network (e.g., same LAN, no NAT).

1. On the remote machine, start the agent:

```bash
sudo spectre-agent up --listen :8081 --token mysecret
```

2. In the web UI, use the **Connect to agent** form. Enter the agent's address (`ws://<agent-ip>:8081/ws`) and the matching token.

The control server dials the agent and establishes the connection. The server will automatically reconnect if the connection drops.

#### Using both at the same time

The agent always starts a local WebSocket server (for outbound connections from the control server), regardless of whether `--host` is specified. This means you can enroll an agent with the server AND connect to it directly:

```bash
sudo spectre-agent up --host wss://server.example.com --enroll <token> --listen :8081 --token mysecret
```

### 4. Access terminals

Click any connected agent in the web UI to open a terminal. Works from any browser on any device.

## Agent management

### Check status

```bash
spectre-agent status
```

Shows whether the agent is running, its PID, device ID, enrollment state, and service status.

### Stop the agent

```bash
sudo spectre-agent down
```

Stops the service and removes the service definition. Device data (device key, enrollment state) is preserved so you can re-enroll later.

To also remove all device data:

```bash
sudo spectre-agent down --purge
```

### Uninstall completely

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/uninstall-agent.sh | sudo bash
```

This stops the service, removes the binary, and cleans up all data directories (`/var/lib/spectre-agent`, `~/.spectre-agent`, lock files).

### Run in foreground (debugging)

```bash
spectre-agent --host wss://<server-host>
```

Runs the agent directly in the terminal without installing a service. Useful for debugging. Press Ctrl+C to stop.

## Production deployment with TLS

Terminate TLS at a reverse proxy (nginx, Traefik, cloud load balancer, etc.) in front of the control server and web UI. The web UI container already runs nginx internally.

Configure your proxy to forward HTTPS traffic to the server on port 8080 and the web UI on port 3000. Agents connect using `wss://`:

```bash
sudo spectre-agent up --host wss://spectre.example.com --enroll <token>
```

The agent warns if you use `ws://` instead of `wss://`.

## Configuration

### Server environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `ADMIN_PASSWORD` | *(none)* | Password for web UI login. If empty, auth is disabled. |
| `DATA_DIR` | `./data` | Directory for persistent device store |
| `AGENT_AUTH_TOKEN` | `changeme` | Legacy shared token for agent auth |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (comma-separated) |

### Agent commands

| Command | Description |
|---------|-------------|
| `spectre-agent` | Run the agent in foreground |
| `spectre-agent up` | Install and start as a system service |
| `spectre-agent down` | Stop and remove the service |
| `spectre-agent down --purge` | Stop, remove service, and delete all device data |
| `spectre-agent status` | Show agent status and connection info |

### Agent flags

| Flag | Default | Description |
|------|---------|-------------|
| `--host` | *(none)* | Control server URL to register with |
| `--enroll` | *(none)* | One-time enrollment token (first run only) |
| `--listen` | `:8081` | Address for the local API server |
| `--token` | `changeme` | Token for outbound connections from the control server |

## Development

1. Start the control server:

```bash
cd server && npm install && npm run dev
```

2. Start the web UI:

```bash
cd web-ui && npm install && npm run dev
```

3. Run the agent:

```bash
cd agent && AGENT_HOST=ws://localhost:8080 ./dev.sh
```

Only one agent instance runs per machine; starting another prints the active PID and connection URL.

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

**Inbound:** Agent dials `wss://server/agents/register` — works through NAT/firewalls. Uses enrollment tokens for initial setup, then per-device keys.

**Outbound:** Server dials `ws://agent:8081/ws` — for directly reachable machines. Uses shared token authentication.

Both directions can be active on the same agent simultaneously.
