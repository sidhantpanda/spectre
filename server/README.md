# Spectre Control Server

Node.js + TypeScript control plane that relays terminal sessions between browser clients and remote agents.

## Quick start

```bash
npm install
npm run dev
```

The server starts on port 8080. Set `ADMIN_PASSWORD` to enable web UI authentication:

```bash
ADMIN_PASSWORD=secret npm run dev
```

## API

### Authentication

| Endpoint | Description |
|----------|-------------|
| `GET /auth/status` | Returns `{ authEnabled: true/false }` |
| `POST /auth/login` | Body: `{ "password": "..." }` → `{ "token": "..." }` |

When `ADMIN_PASSWORD` is set, all endpoints below require `Authorization: Bearer <token>`.

### Agents

| Endpoint | Description |
|----------|-------------|
| `GET /agents` | List all agents with status, system info, Docker containers |
| `POST /agents/connect` | Server dials an agent. Body: `{ "address": "ws://ip:8081/ws", "token": "..." }` |
| `POST /agents/:id/command` | Push keystrokes. Body: `{ "data": "ls\n" }` |
| `POST /agents/refresh-docker` | Re-fetch Docker info from all agents |
| `POST /agents/refresh-system` | Re-fetch system info from all agents |
| `POST /agents/refresh-network` | Re-fetch network info from all agents |

### Devices

| Endpoint | Description |
|----------|-------------|
| `POST /devices/enroll` | Create enrollment token → `{ "token": "...", "expiresAt": ... }` |
| `GET /devices` | List enrolled devices |

### WebSocket endpoints

| Path | Auth | Description |
|------|------|-------------|
| `WS /terminal?id=<agentId>` | UI session token | Browser terminal I/O |
| `WS /agents/events` | UI session token | Live agent status stream |
| `WS /agents/register` | Device key or enrollment token | Agent registration |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `ADMIN_PASSWORD` | *(empty)* | Web UI password. Empty = auth disabled |
| `DATA_DIR` | `./data` | Device store location (JSON file) |
| `AGENT_AUTH_TOKEN` | `changeme` | Legacy shared token |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |

## Project structure

```
src/
  server.ts        — HTTP server bootstrap, device store init
  app.ts           — Express routes, auth middleware
  websockets.ts    — WebSocket upgrade routing, terminal/agent/events handlers
  agentRegistry.ts — In-memory agent tracking, outbound connections, stale sweep
  deviceStore.ts   — JSON-file persistent store for devices and enrollment tokens
  auth.ts          — Session-based auth (login, token validation, middleware)
  config.ts        — Environment variable config
  types.ts         — Shared TypeScript types
  version.ts       — Server version
  utils/
    net.ts         — Client address extraction
    output.ts      — Terminal output summarization
```

## Scripts

```bash
npm run dev    # Start with hot reload (ts-node-dev)
npm run build  # Compile TypeScript to dist/
npm start      # Run compiled output
npm test       # Run tests (vitest)
```

## Docker

```bash
docker build -t spectre-server .
docker run -p 8080:8080 -e ADMIN_PASSWORD=secret spectre-server
```
