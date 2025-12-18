import { v4 as uuid } from "uuid";
import WebSocket, { type RawData } from "ws";
import { summarizeOutput } from "./utils/output";
import { type AgentMessage, type AgentRecord, type ControlMessage } from "./types";

export type AgentEntry = {
  socket?: WebSocket;
  record: AgentRecord;
  token: string;
  backoffMs?: number;
};

export type AgentDependencies = {
  listAgents: () => AgentRecord[];
  connectToAgent: (address: string, token: string) => AgentRecord;
  pushToAgent: (id: string, message: ControlMessage) => void;
  refreshDockerInfo?: () => void;
  refreshSystemInfo?: () => void;
  refreshNetworkInfo?: () => void;
};

type AgentStatusListener = (record: AgentRecord) => void;
type AgentOutputListener = (agentId: string, payload: AgentMessage) => void;

const agents: Map<string, AgentEntry> = new Map();
const statusListeners: Set<AgentStatusListener> = new Set();
const outputListeners: Set<AgentOutputListener> = new Set();

const now = () => Date.now();

export function onAgentStatusChange(listener: AgentStatusListener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function onAgentOutput(listener: AgentOutputListener) {
  outputListeners.add(listener);
  return () => outputListeners.delete(listener);
}

function emitStatus(record: AgentRecord) {
  for (const listener of statusListeners) {
    listener(record);
  }
}

function emitOutput(agentId: string, payload: AgentMessage) {
  for (const listener of outputListeners) {
    listener(agentId, payload);
  }
}

export function listAgents() {
  return Array.from(agents.values()).map((a) => a.record);
}

export function currentAgent(agentId: string) {
  return agents.get(agentId);
}

export function pushToAgent(agentId: string, message: ControlMessage) {
  const entry = agents.get(agentId);
  if (!entry || entry.record.status !== "connected" || !entry.socket) {
    throw new Error("agent not connected");
  }
  entry.socket.send(JSON.stringify(message));
}

export function connectToAgent(address: string, token: string) {
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
  emitStatus(entry.record);

  const socket = new WebSocket(address);
  entry.socket = socket;

  socket.on("open", () => {
    entry.backoffMs = 1000;
    socket.send(JSON.stringify({ type: "hello", token: entry.token } satisfies ControlMessage));
    emitStatus(entry.record);
    console.log(`[agent outbound] dialed ${address} (id=${id})`);
  });

  socket.on("message", (data: RawData) => {
    try {
      const payload = JSON.parse(data.toString()) as AgentMessage;
      entry.record.lastSeen = now();
      if (payload.type === "hello") {
        const deviceId = payload.agentId;
        const existing = activeAgentFor(deviceId, id);
        if (existing) {
          entry.record.status = "disconnected";
          entry.record.lastSeen = now();
          agents.set(id, entry);
          if (socket.readyState === WebSocket.OPEN) {
            socket.close(4001, "agent already connected (keeping first session)");
          }
          emitStatus(entry.record);
          return;
        }
        entry.record.status = "connected";
        entry.record.deviceId = deviceId;
        entry.record.remoteAgentId = deviceId;
        entry.record.fingerprint = payload.fingerprint;
        emitStatus(entry.record);
        requestDockerInfo(id);
        requestSystemInfo(id);
        requestNetworkInfo(id);
      }
      if (payload.type === "output") {
        emitOutput(id, payload);
        const summary = summarizeOutput(payload.data);
        if (summary) {
          const label = entry.record.deviceId ?? entry.record.remoteAgentId ?? entry.record.id;
          console.log(`[agent ${label}] ${payload.data}`);
        }
      }
      if (payload.type === "heartbeat") {
        entry.record.status = "connected";
      }
      if (payload.type === "dockerInfo") {
        entry.record.docker = payload.containers ?? [];
        entry.record.dockerError = payload.error;
        emitStatus(entry.record);
      }
      if (payload.type === "systemInfo") {
        entry.record.systemInfo = payload.systemInfo;
        entry.record.systemInfoError = payload.error;
        emitStatus(entry.record);
      }
      if (payload.type === "networkInfo") {
        entry.record.networkInfo = payload.networkInfo;
        entry.record.networkInfoError = payload.error;
        emitStatus(entry.record);
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
    emitStatus(entry.record);
    const nextBackoff = Math.min((entry.backoffMs ?? 1000) * 2, 30000);
    setTimeout(() => attemptOutboundConnection(id, address, nextBackoff), entry.backoffMs ?? 1000);
  };

  socket.on("close", () => {
    console.log(`[agent outbound] closed ${address} (id=${id})`);
    scheduleReconnect();
  });

  socket.on("error", (err: Error) => {
    console.warn(`[agent outbound] error ${address} (id=${id}): ${err.message}`);
    scheduleReconnect();
  });
}

export function registerInboundAgent(socket: WebSocket, token: string, address: string) {
  const id = uuid();
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
  emitStatus(entry.record);

  socket.on("message", (data: RawData) => {
    try {
      const payload = JSON.parse(data.toString()) as AgentMessage;
      entry.record.lastSeen = now();

      if (payload.type === "hello") {
        const deviceId = payload.agentId;
        const existing = activeAgentFor(deviceId, id);
        if (existing) {
          entry.record.status = "disconnected";
          entry.record.lastSeen = now();
          agents.set(id, entry);
          if (socket.readyState === WebSocket.OPEN) {
            socket.close(4001, "agent already connected (keeping first session)");
          }
          emitStatus(entry.record);
          return;
        }
        entry.record.status = "connected";
        entry.record.deviceId = deviceId;
        entry.record.remoteAgentId = deviceId;
        entry.record.fingerprint = payload.fingerprint;
        agents.set(id, entry);
        socket.send(JSON.stringify({ type: "hello", token } satisfies ControlMessage));
        emitStatus(entry.record);
        requestDockerInfo(id);
        requestSystemInfo(id);
        requestNetworkInfo(id);
        return;
      }

      if (payload.type === "output") {
        emitOutput(id, payload);
        const summary = summarizeOutput(payload.data);
        if (summary) {
          const label = entry.record.deviceId ?? entry.record.remoteAgentId ?? entry.record.id;
          console.log(`[agent ${label}] ${payload.data}`);
        }
      }
      if (payload.type === "heartbeat") {
        entry.record.status = "connected";
      }
      if (payload.type === "dockerInfo") {
        entry.record.docker = payload.containers ?? [];
        entry.record.dockerError = payload.error;
        emitStatus(entry.record);
      }
      if (payload.type === "systemInfo") {
        entry.record.systemInfo = payload.systemInfo;
        entry.record.systemInfoError = payload.error;
        emitStatus(entry.record);
      }
      if (payload.type === "networkInfo") {
        entry.record.networkInfo = payload.networkInfo;
        entry.record.networkInfoError = payload.error;
        emitStatus(entry.record);
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
    emitStatus(entry.record);
    console.log(`[agent inbound] closed ${address} (id=${id})`);
  });

  socket.on("error", (err: Error) => {
    entry.record.status = "disconnected";
    entry.record.lastSeen = now();
    agents.set(id, entry);
    emitStatus(entry.record);
    console.warn(`[agent inbound] error ${address} (id=${id}): ${err.message}`);
  });
}

function activeAgentFor(deviceId: string | undefined, currentId: string) {
  if (!deviceId) return undefined;
  for (const [id, entry] of agents.entries()) {
    if (id === currentId) continue;
    const entryDeviceId = entry.record.deviceId ?? entry.record.remoteAgentId;
    if (entryDeviceId === deviceId && entry.record.status !== "disconnected") {
      return { id, entry };
    }
  }
  return undefined;
}

export function requestDockerInfo(agentId: string) {
  console.log(`[docker] requesting info from agent ${agentId}`);
  try {
    pushToAgent(agentId, { type: "dockerInfo" });
  } catch (err) {
    console.warn(`[docker] unable to request info from agent ${agentId}: ${(err as Error).message}`);
  }
}

export function refreshAllDockerInfo() {
  for (const [id, entry] of agents.entries()) {
    if (entry.record.status === "connected") {
      requestDockerInfo(id);
    }
  }
}

export function requestSystemInfo(agentId: string) {
  console.log(`[system] requesting info from agent ${agentId}`);
  try {
    pushToAgent(agentId, { type: "systemInfo" });
  } catch (err) {
    console.warn(`[system] unable to request info from agent ${agentId}: ${(err as Error).message}`);
  }
}

export function refreshAllSystemInfo() {
  for (const [id, entry] of agents.entries()) {
    if (entry.record.status === "connected") {
      requestSystemInfo(id);
    }
  }
}

export function requestNetworkInfo(agentId: string) {
  console.log(`[network] requesting info from agent ${agentId}`);
  try {
    pushToAgent(agentId, { type: "networkInfo" });
  } catch (err) {
    console.warn(`[network] unable to request info from agent ${agentId}: ${(err as Error).message}`);
  }
}

export function refreshAllNetworkInfo() {
  for (const [id, entry] of agents.entries()) {
    if (entry.record.status === "connected") {
      requestNetworkInfo(id);
    }
  }
}
