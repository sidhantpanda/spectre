# Spectre Agent (Go)

A lightweight Go daemon that exposes an HTTP + WebSocket API so the Spectre control server can dial into a live pseudo-terminal for streaming keystrokes and output.

## Features
- Listens for control connections over WebSockets with a shared auth token.
- Sends a unique fingerprint derived from machine ID, MAC addresses, and NIC names to identify reinstalls.
- Optionally initiates a control connection itself when given a control server `-host` URL.
- Spawns a login shell inside a PTY to support interactive sessions (sudo prompts, terminal control codes, etc.).
- Streams keystrokes from the server to the PTY and streams output back to the server.
- Handles SIGINT/SIGTERM for clean shutdowns.
- Enforces a single running instance per machine and surfaces the active agent details if started again.

## HTTP + WebSocket interface
- `GET /health` — Returns the current agent ID and the collected fingerprint. Example payload:
  ```json
  {
    "agentId": "cb6c79e7d6e14d0c8077c5b2c3b5e9bb0856b2bd",
    "fingerprint": {
      "hostname": "example-host",
      "machineId": "96cc1e9d8f7d4f60b60838d9639e64d0",
      "macAddresses": ["00:1A:2B:3C:4D:5E"],
      "nics": ["lo0", "en0"],
      "fingerprint": "cb6c79e7d6e14d0c8077c5b2c3b5e9bb0856b2bd"
    }
  }
  ```
- `GET /ws` — Upgrades to a WebSocket used for shell I/O. All messages are JSON.

### WebSocket handshake
- Control server → Agent: `{"type":"hello","token":"<shared token>"}`. The token must match the agent `-token` flag.
- Agent → Control server: `{"type":"hello","agentId":"<id>","fingerprint":{...}}`. This is the acknowledgement and includes the same fingerprint data returned by `/health`.
- If the handshake fails (wrong type or token), the agent closes the connection.

### Messages sent **to** the agent
- `keystroke`: `{ "type": "keystroke", "data": "<raw key bytes>" }` — Sent for every chunk of input typed in the control UI. The data is written directly into the PTY; include newline characters when you want to submit a command.

### Messages sent **from** the agent
- `output`: `{ "type": "output", "data": "<stdout/stderr chunk>" }` — PTY output streamed as it is produced. Newlines are preserved.
- `heartbeat`: `{ "type": "heartbeat" }` — Emitted every 25 seconds so the control server can detect liveness.
- `hello`: The handshake acknowledgement described above.

### Typical flow
1) Control server connects to `/ws` and sends the `hello` handshake with the shared token.
2) Agent replies with `hello`, including the agent ID and fingerprint for session attribution.
3) Control server streams `keystroke` messages; the agent writes them into the PTY.
4) Agent streams `output` messages back as commands run, plus periodic `heartbeat` frames.

## Building
```bash
cd agent
GOOS=linux GOARCH=amd64 go build -o spectre-agent ./...
```
The resulting `spectre-agent` binary can be dropped into `/usr/local/bin` on Linux hosts.

## Running
```bash
./spectre-agent \
  -listen :8081 \
  -token changeme \
  -host ws://control-server:8080/agents/register

For local development, you can run `./dev.sh ws://localhost:8080/agents/register <token>` (or set `AGENT_HOST`/`AGENT_TOKEN`). The script also extracts `token=` from the URL if present.

If you start a second agent process on the same machine, it will exit and print the existing agent PID, ID, and connection URL so you can connect using the already-running instance.
```

Flags:
- `-listen` — Address to expose the agent API and WebSocket endpoint (default `:8081`).
- `-token` — Shared auth token expected from the control server.
- `-host` — Optional control server WebSocket endpoint for agent-initiated connections (e.g., `ws://control:8080/agents/register`).

## Releases
- **Tagged releases:** Push a Git tag matching `agent-v*` to trigger `.github/workflows/release-agent.yml`, which cross-compiles the agent (linux/darwin/windows on amd64/arm64) and publishes a GitHub Release with all binaries attached.
- **Nightly builds:** `.github/workflows/release-agent-nightly.yml` runs at 02:00 UTC (or via “Run workflow”) and publishes a prerelease tagged `agent-nightly-YYYYMMDD` with the same cross-platform binaries.
- **Manual nightly:** From the GitHub Actions tab, run the “Nightly Agent Release” workflow to produce the latest prerelease artifacts without waiting for the scheduled run.
- **Manual short-SHA release:** Run the “Manual Agent Release” workflow (`.github/workflows/release-agent-manual.yml`) to publish a release tagged `agent-sha-<short_sha>`, where `<short_sha>` is the 7-character short hash of the commit you triggered from.

### Downloading and running released binaries
Releases attach archives that preserve execute bits on Unix platforms and zips for Windows:

- Linux: `spectre-agent-linux-amd64.tar.gz`, `spectre-agent-linux-arm64.tar.gz`
- macOS: `spectre-agent-darwin-amd64.tar.gz`, `spectre-agent-darwin-arm64.tar.gz`
- Windows: `spectre-agent-windows-amd64.zip`, `spectre-agent-windows-arm64.zip`

Examples (replace `<tag>` with a release like `agent-v1.2.3` and choose the right arch):

```bash
# Linux/macOS
curl -L -o spectre-agent.tar.gz "https://github.com/sidhantpanda/spectre/releases/download/<tag>/spectre-agent-linux-amd64.tar.gz"
tar -xzf spectre-agent.tar.gz
./spectre-agent-linux-amd64 -listen :8081 -token changeme -host ws://control-server-hostname:8080/agents/register

# Windows (PowerShell)
Invoke-WebRequest -Uri "https://github.com/sidhantpanda/spectre/releases/download/<tag>/spectre-agent-windows-amd64.zip" -OutFile spectre-agent.zip
Expand-Archive spectre-agent.zip -DestinationPath .
./spectre-agent-windows-amd64.exe -listen :8081 -token changeme -host ws://control-server-hostname:8080/agents/register
```

## Notes
- PTY mode enables proper handling of `sudo` password prompts and interactive programs.
- The agent keeps running until terminated and will attempt to send heartbeats so the server can mark stale connections.
