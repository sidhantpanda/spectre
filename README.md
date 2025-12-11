# Spectre

Reference layout for a two-part remote command streaming stack:
- **server/** — Node.js + TypeScript control plane built with Express and `ws`.
- **client/** — Go-based agent designed to run on Linux and stream a PTY over WebSockets.

Both components use WebSockets for interactive keystroke and output streaming. Agents authenticate using a shared token and provide a fingerprint derived from machine characteristics so the server can recognize reinstalls.

## Quick Start
1. Start the server (see `server/README.md` for details):
   ```bash
   cd server
   npm install
   npm run dev
   ```
2. Build and run the agent on a target machine:
   ```bash
   cd client
   GOOS=linux GOARCH=amd64 go build -o spectre-agent
   ./spectre-agent -server ws://localhost:8080/ws -token changeme
   ```

The server will log agent connections, maintain an in-memory registry of connected/disconnected agents, and allow pushing keystrokes to live PTY sessions.
