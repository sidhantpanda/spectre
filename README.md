# Spectre

Remote terminal access from any browser. Open a shell on any of your machines from your phone, tablet, or someone else's computer.

![Spectre Control UI](public/control-server.png)

The agent dials out to the server over WebSocket (works through NAT and firewalls), the browser connects to the server, and the server bridges terminal I/O between them. With **tmux** on the remote machine, sessions survive disconnects.

## Develop

`server` (API) and `web-ui` (web) are a **pnpm workspace**; the `agent` is a Go module. You need **Node 20+** and **pnpm 11+** (plus **Go 1.21+** for the agent).

```bash
pnpm install     # once
pnpm dev         # API on :8080 + web UI on :5173, together
```

Open **http://localhost:5173**. To also run the agent locally against your dev server:

```bash
pnpm dev:agent   # connects to ws://localhost:8080, shows up in the web UI
```

More scripts, per-package commands, and the Docker Compose alternative are in the [developer guide](docs/GUIDE.md#development).

## Run in production

On any machine with Docker, create a `compose.yaml`:

```yaml
services:
  server:
    image: ghcr.io/sidhantpanda/spectre/server:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - ADMIN_PASSWORD=changeme  # change this
    volumes:
      - server_data:/data

  web-ui:
    image: ghcr.io/sidhantpanda/spectre/web-ui:latest
    restart: unless-stopped
    ports:
      - "3000:80"
    environment:
      - SPECTRE_SERVER_HOST=http://localhost:8080

volumes:
  server_data:
```

```bash
docker compose up -d
```

Open `http://<server-ip>:3000` and log in with your password.

## Add a machine

Install the agent on the remote machine and point it at your server:

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash
sudo spectre-agent up --host ws://<server-ip>:8080
```

The machine appears in the web UI — click it to open a terminal. `spectre-agent up` installs a systemd/launchd service that starts on boot.

For enrollment tokens (recommended over the default shared token), TLS, building the binary yourself, running without root, and uninstalling, see the [agent guide](docs/GUIDE.md#the-agent).

## Documentation

The [developer & operator guide](docs/GUIDE.md) covers everything in depth:

- [How it works](docs/GUIDE.md#how-it-works) and [architecture](docs/GUIDE.md#how-it-works)
- [Development](docs/GUIDE.md#development) — workspace scripts, per-package commands, tests
- [The agent](docs/GUIDE.md#the-agent) — install, connect, daemon, uninstall
- [The server](docs/GUIDE.md#the-server) — configuration, HTTP + WebSocket API
- [Docker images](docs/GUIDE.md#docker-images), [releases](docs/GUIDE.md#releases), and the [protocol reference](docs/GUIDE.md#protocol-reference)

## Repo layout

| Path | What |
|------|------|
| `server/` | Node.js + TypeScript control server (`@spectre/server`) |
| `web-ui/` | React + Vite web UI (`@spectre/web-ui`) |
| `agent/` | Go agent that runs on remote machines |
| `docs/` | Detailed guide |

## License

See [LICENSE](LICENSE).
