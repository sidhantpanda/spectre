import express, { type NextFunction, type Request, type Response } from "express";
import { createServer, type IncomingMessage } from "http";
import WebSocket, { type RawData, WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";
import { AgentMessage, AgentRecord, AgentStatus, ControlMessage } from "./types";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN || "changeme";

type AgentEntry = {
  socket?: WebSocket;
  record: AgentRecord;
  token: string;
};

const agents: Map<string, AgentEntry> = new Map();
const uiClients: Map<string, Set<WebSocket>> = new Map();

type AgentDependencies = {
  listAgents: () => AgentRecord[];
  connectToAgent: (address: string, token: string) => AgentRecord;
  pushToAgent: (id: string, message: ControlMessage) => void;
};

function now() {
  return Date.now();
}

function listAgents() {
  return Array.from(agents.values()).map((a) => a.record);
}

function connectToAgent(address: string, token: string) {
  const id = uuid();
  const entry: AgentEntry = {
    token,
    record: {
      id,
      address,
      status: "connecting",
      lastSeen: now(),
    },
  };
  agents.set(id, entry);

  const socket = new WebSocket(address);
  entry.socket = socket;

  socket.on("open", () => {
    socket.send(JSON.stringify({ type: "hello", token } satisfies ControlMessage));
    handleAgentStatusChange(id, "connecting");
  });

  socket.on("message", (data: RawData) => {
    try {
      const payload = JSON.parse(data.toString()) as AgentMessage;
      entry.record.lastSeen = now();
      if (payload.type === "hello") {
        entry.record.status = "connected";
        entry.record.remoteAgentId = payload.agentId;
        entry.record.fingerprint = payload.fingerprint;
        handleAgentStatusChange(id, "connected");
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

  socket.on("close", () => {
    entry.record.status = "disconnected";
    entry.record.lastSeen = now();
    agents.set(id, entry);
    handleAgentStatusChange(id, "disconnected");
  });

  socket.on("error", (err: Error) => {
    entry.record.status = "disconnected";
    entry.record.lastSeen = now();
    agents.set(id, entry);
    handleAgentStatusChange(id, "disconnected");
    console.warn(`connection error for agent ${id} (${address})`, err);
  });

  return entry.record;
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

function handleAgentStatusChange(agentId: string, status: AgentStatus) {
  broadcastToUi(agentId, { type: "status", status });
}

// Only start the HTTP server when running the actual app, not during tests.
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  const app = createApp();
  const httpServer = createServer(app);

  const uiWss = new WebSocketServer({ server: httpServer, path: "/terminal" });

  uiWss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const { searchParams } = new URL(req.url ?? "", `http://${req.headers.host}`);
    const agentId = searchParams.get("id");
    if (!agentId) {
      socket.close(1008, "missing agent id");
      return;
    }

    const group = uiClients.get(agentId) ?? new Set<WebSocket>();
    group.add(socket);
    uiClients.set(agentId, group);

    socket.on("message", (data: RawData) => {
      try {
        pushToAgent(agentId, { type: "keystroke", data: data.toString() });
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

  httpServer.listen(PORT, () => {
    console.log(`Spectre control server listening on :${PORT}`);
  });
}
