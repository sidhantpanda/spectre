# Spectre

**A terminal on every machine you own, in any browser.**

Spectre gives you a shell on your servers, home lab boxes, and Raspberry Pis from a browser tab — your phone, a tablet, or someone else's laptop. No SSH keys to carry, no VPN, no port forwarding.

![Spectre Control UI](public/control-server.png)

Install the agent on a machine, approve it once, and it shows up in the web UI. Click it, get a shell. With **tmux** installed, sessions survive disconnects — close the tab on your phone, reopen it on your laptop, and your half-finished command is still there.

```
Browser ◄──── WebSocket ────► Spectre server ◄──── WebSocket ────► Agent (+ tmux)
```

Everything arrives on **one port**. A reverse proxy fronts the deployment and
splits traffic by path — `/api/*` to the control server (REST and every
WebSocket, the agent's included), everything else to the static web UI:

```
                        ┌──────────── proxy :3000 ───────────┐
Browser  ──────────────►│  /api/*  ──►  server  (unpublished) │
Agent    ──────────────►│  /*      ──►  web-ui  (unpublished) │
                        └────────────────────────────────────┘
```

The agent **dials out** to your server and never opens a port, so it works behind NAT, CGNAT, and restrictive firewalls. There is nothing to expose on the machines you're connecting to.

---

## Quickstart

Two steps: run a server, add a machine.

### 1. Run the server

```bash
# Generate a password — the server will not start without one.
export ADMIN_PASSWORD=$(openssl rand -base64 24)
echo "Your password: $ADMIN_PASSWORD"

BASE=https://raw.githubusercontent.com/sidhantpanda/spectre/main
curl -fsSL $BASE/compose.yaml -o compose.yaml
curl -fsSL $BASE/default.conf.template -o default.conf.template
docker compose up -d
```

`default.conf.template` is the reverse proxy's nginx config. Compose mounts it
into the stock `nginx` image — there is no Spectre proxy image to pull.

Open `http://<server-ip>:3000` and log in.

> **Before you expose this to the internet**, put it behind a reverse proxy with TLS and use `wss://`. Spectre hands out root shells; treat the server like an SSH bastion. See [Production checklist](docs/GUIDE.md#production-checklist).

### 2. Add a machine

**One line** — for scripts, cloud-init, and images. Create an auth key in the UI ("Add a machine" → *Create auth key*), which hands you a command to paste on the target machine:

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh \
  | sudo SPECTRE_AUTHKEY=sk_... bash -s -- --host wss://spectre.example.com
```

That downloads the agent build matching the machine's OS and architecture, installs it, enrolls it, and starts it as a service. The key goes through the environment so it never appears in `ps`.

**Interactive** — no secrets to copy around. Install the agent first:

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh | sudo bash
```

Then connect it:

```bash
sudo spectre-agent up --host wss://spectre.example.com
```

It prints a code and a link. Open the link in Spectre, approve the code, done:

```
To add this machine, open Spectre and approve it:

    https://spectre.example.com/enroll

    Code:  XNV3-VH3T

Waiting for approval...
```

You can also skip the auth key and let the installer do the same thing — pass `--host` with no key and it prints the code for you:

```bash
curl -fsSL https://raw.githubusercontent.com/sidhantpanda/spectre/main/scripts/install-agent.sh \
  | sudo bash -s -- --host wss://spectre.example.com
```

Either way the machine enrolls, stores a device key, installs itself as a service, and reconnects on boot. Click it in the UI to open a terminal.

### 3. Remove a machine

To uninstall the agent, run this on the machine itself:

```bash
sudo spectre-agent down
```

This stops and removes the service but keeps the stored device key, so running `spectre-agent up` again re-enrolls without another approval. To also delete the device key and enrollment state, add `--purge`:

```bash
sudo spectre-agent down --purge
```

Neither removes the binary itself. Delete it when you're done:

```bash
sudo rm /usr/local/bin/spectre-agent
```

Removing the agent doesn't delete the device from the control server. Use **Remove** on the (now disconnected) device in the web UI to drop it from the list.

---

## Security model

Spectre gives a browser a root shell on your machines. That deserves to be stated plainly.

| | |
|---|---|
| **Who can open a shell** | Anyone with the `ADMIN_PASSWORD`. There is one admin; there are no per-user accounts or per-machine ACLs yet. |
| **How machines authenticate** | Each machine holds its own **device key**, issued at enrollment and stored `0600`. Keys are stored **hashed** on the server — a stolen database cannot impersonate a machine. |
| **How machines are added** | An **auth key** (single-use by default, expiring) or an admin approving a code. A machine is never trusted until you say so. |
| **What the agent exposes** | Nothing. It dials out and listens on no port. |
| **Revoking a machine** | Revoke it in the UI — the live session is killed immediately and the key stops working. |
| **Transport** | Use `wss://`. Bare hostnames default to TLS; the agent warns loudly on plaintext to a non-local host. |

**The server refuses to start without `ADMIN_PASSWORD`.** This is deliberate: an unauthenticated Spectre server is an anonymous root shell for every enrolled machine. For local development only, set `SPECTRE_DEV_NO_AUTH=1` (which is itself refused when `NODE_ENV=production`).

Credentials never appear in URLs or logs. Agents authenticate with an `Authorization` header, and browser terminals use short-lived single-use tickets, because query strings end up in proxy logs and `Referer` headers.

Found a security issue? Please report it privately rather than opening a public issue.

---

## Develop

`server` (API) and `web-ui` are a **pnpm workspace**; `agent` is a Go module. You need **Node 22+**, **pnpm 11+**, and **Go 1.21+** for the agent.

```bash
pnpm install     # once
pnpm dev         # API on :8080 + web UI on :5173
```

Open **http://localhost:5173**. `pnpm dev` sets `SPECTRE_DEV_NO_AUTH=1`, so there's no login in development.

To run an agent against your dev server:

```bash
pnpm dev:agent   # mints an auth key, enrolls, and hot-reloads on changes
```

### Build an agent for another machine

`pnpm dev:agent` only runs an agent on *this* machine. To get one onto a Pi or a server, cross-compile a binary and copy it across. The agent is a single static binary (`CGO_ENABLED=0`) with no runtime dependencies, so it runs on old distros without glibc trouble.

Build both common Linux architectures in one go — the binaries land in `agent/`:

```bash
cd agent
for arch in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH=$arch \
    go build -ldflags "-X main.agentVersion=$(git describe --tags --always)" \
    -o "spectre-agent-linux-$arch" .
done
```

That gives you `agent/spectre-agent-linux-amd64` and `agent/spectre-agent-linux-arm64`. For a single target, run one of them directly:

```bash
cd agent
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o spectre-agent-linux-arm64 .
```

Run `uname -sm` on the target to see which one it needs:

| `uname -sm` | Build with | Typical machine |
|---|---|---|
| `Linux x86_64` | `GOOS=linux GOARCH=amd64` | Servers, NUCs, most VPS |
| `Linux aarch64` | `GOOS=linux GOARCH=arm64` | Raspberry Pi 4/5 on a 64-bit OS |
| `Linux armv6l` / `armv7l` | `GOOS=linux GOARCH=arm GOARM=6` | Pi Zero, 32-bit Pi OS |
| `Darwin arm64` | `GOOS=darwin GOARCH=arm64` | Apple Silicon Mac |
| `Darwin x86_64` | `GOOS=darwin GOARCH=amd64` | Intel Mac |

Copy it over and install it. `scp` can't write to `/usr/local/bin` directly, so land it somewhere writable first:

```bash
scp agent/spectre-agent-linux-arm64 myhost:/tmp/spectre-agent
ssh myhost 'sudo install -m 755 /tmp/spectre-agent /usr/local/bin/spectre-agent && rm /tmp/spectre-agent'
```

Then enroll it against your dev server. **Use your dev machine's LAN IP, not `localhost`** — on the target, `localhost` is the target:

```bash
ssh -t myhost 'sudo spectre-agent up --host ws://192.0.2.10:3000'
```

Two things worth knowing: install **tmux** on the target if you want sessions to survive disconnects and agent restarts, and the `-ldflags` above is optional — without it the agent reports its version as `dev-<timestamp>`.

To remove a hand-installed agent later, `sudo spectre-agent down --purge` on the target, then delete `/usr/local/bin/spectre-agent`.

```bash
pnpm test        # test every package
pnpm build       # build every package
pnpm lint        # type-check the web UI
```

More detail — per-package commands, Docker Compose, the HTTP/WebSocket API, and the wire protocol — is in the [developer & operator guide](docs/GUIDE.md).

## Repo layout

| Path | What |
|------|------|
| `server/` | Node.js + TypeScript control server (`@spectre/server`) |
| `web-ui/` | React + Vite web UI (`@spectre/web-ui`) |
| `agent/` | Go agent that runs on remote machines |
| `docs/` | Developer & operator guide |

## Documentation

- [How it works](docs/GUIDE.md#how-it-works) — architecture and the connection model
- [Production checklist](docs/GUIDE.md#production-checklist) — TLS, reverse proxy, hardening
- [The agent](docs/GUIDE.md#the-agent) — install, enroll, daemon, uninstall
- [The server](docs/GUIDE.md#the-server) — configuration and API reference
- [Protocol reference](docs/GUIDE.md#protocol-reference) — the wire format

## License

See [LICENSE](LICENSE).
