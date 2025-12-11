# Spectre Agent (Go)

A lightweight Go daemon that exposes an HTTP + WebSocket API so the Spectre control server can dial into a live pseudo-terminal for streaming keystrokes and output.

## Features
- Listens for control connections over WebSockets with a shared auth token.
- Sends a unique fingerprint derived from machine ID, MAC addresses, and NIC names to identify reinstalls.
- Spawns a login shell inside a PTY to support interactive sessions (sudo prompts, terminal control codes, etc.).
- Streams keystrokes from the server to the PTY and streams output back to the server.
- Handles SIGINT/SIGTERM for clean shutdowns.

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
  -token changeme
```

Flags:
- `-listen` — Address to expose the agent API and WebSocket endpoint (default `:8081`).
- `-token` — Shared auth token expected from the control server.

## Notes
- PTY mode enables proper handling of `sudo` password prompts and interactive programs.
- The agent keeps running until terminated and will attempt to send heartbeats so the server can mark stale connections.
