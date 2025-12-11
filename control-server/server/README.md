# Spectre Control Server

A Node.js + TypeScript control plane that keeps track of connected Spectre agents, exposes a WebSocket endpoint for bi-directional terminal streaming, and provides REST endpoints for administrative actions.

## Features
- Express HTTP server with WebSocket upgrade endpoint using `ws`.
- Token-based authentication for agents during handshake.
- Tracks connected/disconnected agents and exposes `/agents` listing.
- Provides a `/agents/:id/command` endpoint to push keystrokes or commands to an agent's pseudo-terminal session.
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
- `POST /agents/:id/command` — Pushes keystrokes/command text to the agent. Body: `{ "data": "ls -la\n" }`.
- WebSocket endpoint: `ws://<host>:<port>/ws`. Agents send a `hello` frame on connect.

## Project Structure
- `src/server.ts` — Express setup, WebSocket handling, and in-memory agent registry.
- `src/types.ts` — Shared message/agent types used by the server.

## Notes
- This implementation is intentionally simple and keeps state in memory. For a real deployment, plug in durable storage and a permission model for operator sessions.
- The server currently trusts a single shared token. Replace with JWT or mTLS for stronger identity.
