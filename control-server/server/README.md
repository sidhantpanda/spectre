# Spectre Control Server

A Node.js + TypeScript control plane that dials into Spectre agents, keeps track of connection status, and provides REST endpoints for sending commands.

## Features
- Express HTTP server that connects outward to agent WebSocket endpoints using `ws`.
- Token-based authentication shared with agents during handshake.
- Tracks connecting/connected/disconnected agents and exposes a `/agents` listing.
- `/agents/connect` endpoint that instructs the control server to dial a remote agent address.
- `/agents/:id/command` endpoint to push keystrokes or commands to an agent's pseudo-terminal session.
- In-memory registry for demo purposes; swap with persistent storage or a message bus for production.

## Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Set the `AGENT_AUTH_TOKEN` environment variable to match the token configured on agents.

## API
- `GET /agents` — Lists known agents with connection status and fingerprint metadata.
- `POST /agents/connect` — Body: `{ "address": "ws://<agent-ip>:8081/ws", "token": "changeme" }` to initiate a connection.
- `POST /agents/:id/command` — Pushes keystrokes/command text to the agent. Body: `{ "data": "ls -la\n" }`.

## Project Structure
- `src/server.ts` — Express setup, outbound WebSocket handling, and in-memory agent registry.
- `src/types.ts` — Shared message/agent types used by the server.

## Notes
- This implementation is intentionally simple and keeps state in memory. For a real deployment, plug in durable storage and a permission model for operator sessions.
- The server currently trusts a single shared token. Replace with JWT or mTLS for stronger identity.
