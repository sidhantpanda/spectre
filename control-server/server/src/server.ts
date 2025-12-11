import express, { type NextFunction, type Request, type Response } from "express";
import { createServer } from "http";
import WebSocket, { type RawData } from "ws";
import { v4 as uuid } from "uuid";
import { AgentMessage, AgentRecord, ControlMessage } from "./types";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN || "changeme";

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

const httpServer = createServer(app);

type AgentEntry = {
  socket?: WebSocket;
  record: AgentRecord;
  token: string;
};

const agents: Map<string, AgentEntry> = new Map();

function now() {
  return Date.now();
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
  });

  socket.on("message", (data: RawData) => {
    try {
      const payload = JSON.parse(data.toString()) as AgentMessage;
      entry.record.lastSeen = now();
      if (payload.type === "hello") {
        entry.record.status = "connected";
        entry.record.remoteAgentId = payload.agentId;
        entry.record.fingerprint = payload.fingerprint;
      }
      if (payload.type === "output") {
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
  });

  socket.on("error", (err: Error) => {
    entry.record.status = "disconnected";
    entry.record.lastSeen = now();
    agents.set(id, entry);
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

app.get("/agents", (_req: Request, res: Response) => {
  const records = Array.from(agents.values()).map((a) => a.record);
  res.json(records);
});

app.post("/agents/connect", (req: Request, res: Response) => {
  const { address, token } = req.body as { address?: string; token?: string };
  if (!address) {
    return res.status(400).json({ error: "missing address" });
  }
  const record = connectToAgent(address, token || AUTH_TOKEN);
  res.json(record);
});

app.post("/agents/:id/command", (req: Request, res: Response) => {
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

httpServer.listen(PORT, () => {
  console.log(`Spectre control server listening on :${PORT}`);
});
