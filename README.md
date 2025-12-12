# Spectre

Reference layout for a two-part remote command streaming stack:
- **server/** — Node.js + TypeScript control plane built with Express and `ws` that dials out to remote agents.
- **web-ui/** — Vite + React + TypeScript UI for asking the control server to connect to agent endpoints and run commands.
- **agent/** — Go-based agent that exposes an API/WebSocket server so the control plane can reach in and stream a PTY.

Both components use WebSockets for interactive keystroke and output streaming. Agents authenticate using a shared token and provide a fingerprint derived from machine characteristics so the server can recognize reinstalls.

## Quick Start
1. Start the control server API (see `server/README.md` for details):
   ```bash
   cd server
   npm install
   npm run dev
   ```
2. Start the UI for interacting with the control server:
   ```bash
   cd web-ui
   npm install
   npm run dev
   ```
3. Build and run the agent on a target machine. It hosts its own API/WebSocket server and waits for the control plane to connect:
   ```bash
   cd agent
   GOOS=linux GOARCH=amd64 go build -o spectre-agent
   ./spectre-agent -listen :8081 -token changeme \
     -host ws://<control-server-host>:8080/agents/register
   ```
   Only one agent instance runs per machine; starting another prints the active PID and connection URL for reuse.
4. In the control server UI, paste the remote agent address (e.g., `ws://<agent-ip>:8081/ws`) and click **Connect**. The control server will dial the agent and forward commands/output through the UI.

The control server now initiates connections to agent API servers, accepts inbound agent-initiated control sessions, maintains an in-memory registry of connection state, and allows pushing keystrokes to live PTY sessions.
