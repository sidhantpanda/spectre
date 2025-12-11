# Spectre Agent (Go)

A lightweight Go daemon that establishes a persistent WebSocket session with the Spectre control server and exposes a live pseudo-terminal for streaming keystrokes and output.

## Features
- Connects to the Spectre server over WebSockets with a shared auth token.
- Sends a unique fingerprint derived from machine ID, MAC addresses, and NIC names to identify reinstalls.
- Spawns a login shell inside a PTY to support interactive sessions (sudo prompts, terminal control codes, etc.).
- Streams keystrokes from the server to the PTY and streams output back to the server.
- Handles SIGINT/SIGTERM for clean shutdowns.

## Building
```bash
cd client
GOOS=linux GOARCH=amd64 go build -o spectre-agent ./...
```
The resulting `spectre-agent` binary can be dropped into `/usr/local/bin` on Linux hosts.

## Running
```bash
./spectre-agent \
  -server ws://localhost:8080/ws \
  -token changeme
```

Flags:
- `-server` — WebSocket endpoint of the Spectre server.
- `-token` — Shared auth token expected by the server.

## Notes
- PTY mode enables proper handling of `sudo` password prompts and interactive programs.
- The agent keeps running until terminated and will attempt to send heartbeats so the server can mark stale connections.
