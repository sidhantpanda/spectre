# Spectre Agent

Lightweight Go binary that runs on remote machines. Exposes a PTY-backed terminal over WebSocket so you can access it from the Spectre web UI.

## Quick start (development)

Run the agent locally and connect it to a dev control server:

```bash
# From the agent/ directory
go run . --host ws://localhost:8080
```

Or use the dev script with auto-reload on file changes:

```bash
./dev.sh ws://localhost:8080
```

The dev script uses `watchexec` or `entr` if available, otherwise falls back to polling.

## Building

```bash
go build -o spectre-agent .
```

Cross-compile:

```bash
GOOS=linux GOARCH=amd64 go build -o spectre-agent .
GOOS=linux GOARCH=arm64 go build -o spectre-agent .
GOOS=darwin GOARCH=arm64 go build -o spectre-agent .
GOOS=windows GOARCH=amd64 go build -o spectre-agent.exe .
```

## Installing on a remote machine

One-liner (downloads latest release, installs to `/usr/local/bin`):

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash
```

## Connecting to the control server

### Option A: Agent dials server (inbound, NAT-friendly)

1. Generate an enrollment token in the web UI
2. On the remote machine:

```bash
sudo spectre-agent up --host wss://server.example.com --enroll <token>
```

This enrolls the agent, stores a permanent device key, installs as a service, and starts it. The enrollment token is one-time use. On subsequent restarts the stored key is used.

### Option B: Server dials agent (outbound, same LAN)

```bash
sudo spectre-agent up --listen :8081 --token mysecret
```

Then enter `ws://<agent-ip>:8081/ws` and the token in the web UI.

### Both at once

```bash
sudo spectre-agent up --host wss://server.example.com --enroll <token> --listen :8081 --token mysecret
```

## Commands

| Command | Description |
|---------|-------------|
| `spectre-agent` | Run in foreground (Ctrl+C to stop) |
| `spectre-agent up` | Install and start as a system service |
| `spectre-agent down` | Stop and remove the service |
| `spectre-agent down --purge` | Also remove device key and all data |
| `spectre-agent status` | Show running state, device ID, enrollment |

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--host` | | Control server URL (e.g. `wss://server.example.com`) |
| `--enroll` | | One-time enrollment token from the web UI |
| `--listen` | `:8081` | Address for the local WebSocket server |
| `--token` | `changeme` | Token the control server must present for outbound connections |

## Uninstall

Stop the service and remove the binary:

```bash
sudo spectre-agent down --purge
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/uninstall-agent.sh | sudo bash
```

## How it works

The agent does two things:

1. **Local WebSocket server** (`--listen :8081`) — Accepts connections from the control server. The server must present a matching `--token`. Used for outbound (server-dials-agent) connections.

2. **Outbound connection** (`--host wss://...`) — Dials the control server and registers. Uses enrollment token (first time) or stored device key (subsequent). Used for inbound (agent-dials-server) connections.

Both run simultaneously. Terminal I/O is bridged between the WebSocket and a PTY running the user's shell.

### WebSocket protocol

Messages are JSON. The agent speaks:

| Direction | Type | Description |
|-----------|------|-------------|
| Agent → Server | `hello` | Handshake with agent ID, fingerprint, version |
| Agent → Server | `output` | PTY output chunks |
| Agent → Server | `heartbeat` | Sent every 25s for liveness |
| Agent → Server | `dockerInfo` | Docker container list |
| Agent → Server | `systemInfo` | OS, CPU, memory, disk |
| Agent → Server | `networkInfo` | IPv4/IPv6 addresses |
| Server → Agent | `hello` | Handshake response (with device key on enrollment) |
| Server → Agent | `keystroke` | Terminal input from browser |
| Server → Agent | `reset` | Start a new shell session |
| Server → Agent | `dockerInfo` | Request container info |
| Server → Agent | `systemInfo` | Request system info |
| Server → Agent | `networkInfo` | Request network info |

### Data storage

- Device ID and key: `~/.spectre-agent/device-info.json` (or `/var/lib/spectre-agent/` when running as a service)
- Lock file: `/tmp/spectre-agent.lock` (prevents duplicate instances)

## Releases

Push a Git tag matching `agent-v*` to trigger the release workflow. It cross-compiles for linux/darwin/windows on amd64/arm64 and publishes to GitHub Releases.

## Running tests

```bash
go test ./...
```
