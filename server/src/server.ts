import express, { type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import { createServer, type IncomingMessage } from "http";
import { type AddressInfo } from "net";
import WebSocket, { type RawData, WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";
import { AgentMessage, AgentRecord, ControlMessage } from "./types";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN || "changeme";

type AgentEntry = {
  socket?: WebSocket;
  record: AgentRecord;
  token: string;
  backoffMs?: number;
};

const agents: Map<string, AgentEntry> = new Map();
const uiClients: Map<string, Set<WebSocket>> = new Map();
const agentEventClients: Set<WebSocket> = new Set();

type AgentDependencies = {
  listAgents: () => AgentRecord[];
  connectToAgent: (address: string, token: string) => AgentRecord;
  pushToAgent: (id: string, message: ControlMessage) => void;
};

function now() {
  return Date.now();
}

function inboundAddress(req: IncomingMessage) {
  const ip = req.socket.remoteAddress ?? "inbound";
  const port = req.socket.remotePort;
  return port ? `${ip}:${port}` : ip;
}

function listAgents() {
  return Array.from(agents.values()).map((a) => a.record);
}

function currentAgent(agentId: string) {
  return agents.get(agentId);
}

function connectToAgent(address: string, token: string) {
  const id = uuid();
  const connectionId = uuid();
  const entry: AgentEntry = {
    token,
    record: {
      id,
      connectionId,
      address,
      status: "connecting",
      lastSeen: now(),
      direction: "outbound",
    },
  };
  agents.set(id, entry);

  attemptOutboundConnection(id, address);
  return entry.record;
}

function attemptOutboundConnection(id: string, address: string, backoffMs = 1000) {
  const entry = agents.get(id);
  if (!entry) return;
  entry.backoffMs = backoffMs;
  entry.record.status = "connecting";
  entry.record.lastSeen = now();
  agents.set(id, entry);
  handleAgentStatusChange(entry.record);

  const socket = new WebSocket(address);
  entry.socket = socket;

  socket.on("open", () => {
    entry.backoffMs = 1000;
    socket.send(JSON.stringify({ type: "hello", token: entry.token } satisfies ControlMessage));
    handleAgentStatusChange(entry.record);
  });

  socket.on("message", (data: RawData) => {
    try {
      const payload = JSON.parse(data.toString()) as AgentMessage;
      entry.record.lastSeen = now();
      if (payload.type === "hello") {
        const existing = activeAgentFor(payload.agentId, id);
        if (existing) {
          entry.record.status = "disconnected";
          entry.record.lastSeen = now();
          agents.set(id, entry);
          if (socket.readyState === WebSocket.OPEN) {
            socket.close(4001, "agent already connected (keeping first session)");
          }
          handleAgentStatusChange(entry.record);
          return;
        }
        entry.record.status = "connected";
        entry.record.remoteAgentId = payload.agentId;
        entry.record.fingerprint = payload.fingerprint;
        handleAgentStatusChange(entry.record);
      }
      if (payload.type === "output") {
        broadcastToUi(id, payload);
        console.log(
          `[agent ${entry.record.remoteAgentId ?? entry.record.id}] output: ${payload.data.substring(0, 120)}`,
        );
      }
      if (payload.type === "heartbeat") {
        entry.record.status = "connected";
      }
      agents.set(id, entry);
    } catch (err) {
      console.error("invalid message from agent", err);
    }
  });

  const scheduleReconnect = () => {
    entry.record.status = "disconnected";
    entry.record.lastSeen = now();
    agents.set(id, entry);
    handleAgentStatusChange(entry.record);
    const nextBackoff = Math.min((entry.backoffMs ?? 1000) * 2, 30000);
    setTimeout(() => attemptOutboundConnection(id, address, nextBackoff), entry.backoffMs ?? 1000);
  };

  socket.on("close", () => {
    scheduleReconnect();
  });

  socket.on("error", (err: Error) => {
    console.warn(`connection error for agent ${id} (${address})`, err);
    scheduleReconnect();
  });
}

function pushToAgent(agentId: string, message: ControlMessage) {
  const entry = agents.get(agentId);
  if (!entry || entry.record.status !== "connected" || !entry.socket) {
    throw new Error("agent not connected");
  }
  entry.socket.send(JSON.stringify(message));
}

export function createApp(
  deps: AgentDependencies = {
    listAgents,
    connectToAgent,
    pushToAgent,
  },
  defaultToken: string = AUTH_TOKEN,
) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.get("/agents", (_req: Request, res: Response) => {
    res.json(deps.listAgents());
  });

  app.post("/agents/connect", (req: Request, res: Response) => {
    const { address, token } = req.body as { address?: string; token?: string };
    if (!address) {
      return res.status(400).json({ error: "missing address" });
    }
    const record = deps.connectToAgent(address, token || defaultToken);
    res.json(record);
  });

  app.post("/agents/:id/command", (req: Request, res: Response) => {
    const { id } = req.params;
    const { data } = req.body as { data?: string };
    if (!data) {
      return res.status(400).json({ error: "missing data" });
    }
    try {
      deps.pushToAgent(id, { type: "keystroke", data });
      res.json({ status: "sent" });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  return app;
}

function broadcastToUi(agentId: string, payload: { type: string; [key: string]: unknown }) {
  const clients = uiClients.get(agentId);
  if (!clients) return;
  for (const socket of clients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }
}

function broadcastAgentEvent(record: AgentRecord) {
  for (const socket of agentEventClients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "agent", agent: record }));
    }
  }
}

function activeAgentFor(remoteAgentId: string | undefined, currentId: string) {
  if (!remoteAgentId) return undefined;
  for (const [id, entry] of agents.entries()) {
    if (id === currentId) continue;
    if (entry.record.remoteAgentId === remoteAgentId && entry.record.status !== "disconnected") {
      return { id, entry };
    }
  }
  return undefined;
}

function handleAgentStatusChange(record: AgentRecord) {
  broadcastToUi(record.id, {
    type: "status",
    status: record.status,
    fingerprint: record.fingerprint,
    remoteAgentId: record.remoteAgentId,
    agentId: record.id,
    connectionId: record.connectionId,
  });
  broadcastAgentEvent(record);
}

// Only start the HTTP server when running the actual app, not during tests.
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  const app = createApp();
  const httpServer = createServer(app);

  const uiWss = new WebSocketServer({ noServer: true });
  const agentEventsWss = new WebSocketServer({ noServer: true });
  const inboundAgentWss = new WebSocketServer({ noServer: true });

  inboundAgentWss.on("wsClientError", (err: Error, _socket: WebSocket, req: IncomingMessage) => {
    console.warn(`[agent inbound] wsClientError ${req.url ?? ""}: ${err.message}`);
    try {
      fs.appendFileSync(
        "/tmp/spectre-ws-errors.log",
        `[${new Date().toISOString()}] ${req.url ?? ""} ${err.message}\n`,
      );
    } catch {
      /* ignore file write errors */
    }
  });

  uiWss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const { searchParams } = new URL(req.url ?? "", `http://${req.headers.host}`);
    const agentId = searchParams.get("id");
    if (!agentId) {
      socket.close(1008, "missing agent id");
      return;
    }

    const entry = currentAgent(agentId);
    if (!entry) {
      socket.close(4404, "agent not found");
      return;
    }

    socket.send(
      JSON.stringify({
        type: "status",
        status: entry.record.status,
        fingerprint: entry.record.fingerprint,
        remoteAgentId: entry.record.remoteAgentId,
        agentId: entry.record.id,
        connectionId: entry.record.connectionId,
      }),
    );

    const group = uiClients.get(agentId) ?? new Set<WebSocket>();
    group.add(socket);
    uiClients.set(agentId, group);

    try {
      deps.pushToAgent(agentId, { type: "reset" });
    } catch (err) {
      socket.send(JSON.stringify({ type: "error", message: (err as Error).message }));
    }

    socket.on("message", (data: RawData) => {
      try {
        const parsed = JSON.parse(data.toString()) as { type?: string; data?: string };
        if (parsed.type !== "input" || typeof parsed.data !== "string") return;
        pushToAgent(agentId, { type: "keystroke", data: parsed.data });
      } catch (err) {
        socket.send(JSON.stringify({ type: "error", message: (err as Error).message }));
      }
    });

    socket.on("close", () => {
      group.delete(socket);
      if (group.size === 0) {
        uiClients.delete(agentId);
      }
    });
  });

  agentEventsWss.on("connection", (socket: WebSocket) => {
    agentEventClients.add(socket);
    socket.send(JSON.stringify({ type: "agents", agents: listAgents() }));

    socket.on("close", () => {
      agentEventClients.delete(socket);
    });
  });

  inboundAgentWss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    console.log(`[agent inbound] connection attempt ${req.url ?? ""} from ${inboundAddress(req)}`);
    const { searchParams } = new URL(req.url ?? "", `http://${req.headers.host}`);
    const token = searchParams.get("token") || AUTH_TOKEN;
    if (token !== AUTH_TOKEN) {
      socket.close(4401, "invalid token");
      return;
    }

    const id = uuid();
    const address = inboundAddress(req);
    const entry: AgentEntry = {
      socket,
      token,
      record: {
        id,
        connectionId: uuid(),
        address,
        status: "connecting",
        lastSeen: now(),
        direction: "inbound",
      },
    };
    agents.set(id, entry);
    handleAgentStatusChange(entry.record);

    socket.on("message", (data: RawData) => {
      try {
        const payload = JSON.parse(data.toString()) as AgentMessage;
        entry.record.lastSeen = now();

        if (payload.type === "hello") {
          const existing = activeAgentFor(payload.agentId, id);
          if (existing) {
            entry.record.status = "disconnected";
            entry.record.lastSeen = now();
            agents.set(id, entry);
            if (socket.readyState === WebSocket.OPEN) {
              socket.close(4001, "agent already connected (keeping first session)");
            }
            handleAgentStatusChange(entry.record);
            return;
          }
          entry.record.status = "connected";
          entry.record.remoteAgentId = payload.agentId;
          entry.record.fingerprint = payload.fingerprint;
          agents.set(id, entry);
          socket.send(JSON.stringify({ type: "hello", token } satisfies ControlMessage));
          handleAgentStatusChange(entry.record);
          return;
        }

        if (payload.type === "output") {
          broadcastToUi(id, payload);
          console.log(
            `[agent ${entry.record.remoteAgentId ?? entry.record.id}] output: ${payload.data.substring(0, 120)}`,
          );
        }
        if (payload.type === "heartbeat") {
          entry.record.status = "connected";
        }
        agents.set(id, entry);
      } catch (err) {
        console.error("invalid message from inbound agent", err);
      }
    });

    socket.on("close", () => {
      entry.record.status = "disconnected";
      entry.record.lastSeen = now();
      agents.set(id, entry);
      handleAgentStatusChange(entry.record);
    });

    socket.on("error", (err: Error) => {
      entry.record.status = "disconnected";
      entry.record.lastSeen = now();
      agents.set(id, entry);
      handleAgentStatusChange(entry.record);
      console.warn(`connection error for inbound agent ${id} (${address})`, err);
    });
  });

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const { pathname } = new URL(req.url ?? "", `http://${req.headers.host}`);
    const key = req.headers["sec-websocket-key"] ? "present" : "missing";
    console.log(
      `[ws upgrade] ${req.method} ${req.url} upgrade=${req.headers.upgrade} version=${req.headers["sec-websocket-version"]} key=${key}`,
    );
    if (pathname === "/terminal") {
      uiWss.handleUpgrade(req, socket, head, (ws) => uiWss.emit("connection", ws, req));
      return;
    }
    if (pathname === "/agents/events") {
      agentEventsWss.handleUpgrade(req, socket, head, (ws) => agentEventsWss.emit("connection", ws, req));
      return;
    }
    if (pathname === "/agents/register") {
      inboundAgentWss.handleUpgrade(req, socket, head, (ws) => inboundAgentWss.emit("connection", ws, req));
      return;
    }
    socket.destroy();
  });

  httpServer.listen(PORT, () => {
    console.log(`Spectre control server listening on :${PORT}`);
    const addr = httpServer.address();
    if (addr && typeof addr === "object") {
      const { address, port } = addr as AddressInfo;
      const host = address === "::" || address === "0.0.0.0" ? "localhost" : address;
      const wsURL = `ws://${host}:${port}/agents/register`;
      console.log(`Agents can initiate inbound control with: ./spectre-agent -host ${wsURL} -token ${AUTH_TOKEN}`);
    } else {
      console.log(`Agents can initiate inbound control using /agents/register with token ${AUTH_TOKEN}`);
    }
  });
}
