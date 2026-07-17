import { v4 as uuid } from "uuid";
import WebSocket, { type RawData } from "ws";
import { summarizeOutput } from "./utils/output";
import { type AgentMessage, type AgentRecord, type ControlMessage } from "./types";

/**
 * Agents always dial the server, never the reverse. That is what lets them sit
 * behind NAT, and it means the server never opens outbound connections to
 * addresses it was handed.
 */

export type AgentEntry = {
  socket: WebSocket;
  record: AgentRecord;
  /** Store id of the device this connection authenticated as. */
  deviceStoreId?: string;
};

export type AgentDependencies = {
  listAgents: () => AgentRecord[];
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

// A single terminal frame is bounded by the agent's read buffer; anything far
// larger is a malformed or hostile peer rather than shell output.
const MAX_AGENT_MESSAGE_BYTES = 256 * 1024;

const DEBUG_TERMINAL = process.env.SPECTRE_DEBUG_TERMINAL === "1";

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
  for (const listener of statusListeners) listener(record);
}

function emitOutput(agentId: string, payload: AgentMessage) {
  for (const listener of outputListeners) listener(agentId, payload);
}

export function listAgents() {
  return Array.from(agents.values()).map((a) => a.record);
}

export function currentAgent(agentId: string) {
  return agents.get(agentId);
}

export function pushToAgent(agentId: string, message: ControlMessage) {
  const entry = agents.get(agentId);
  if (!entry || entry.record.status !== "connected") {
    throw new Error("agent not connected");
  }
  entry.socket.send(JSON.stringify(message));
}

/** Drops any live connections belonging to a revoked device. */
export function disconnectDevice(deviceStoreId: string) {
  for (const entry of agents.values()) {
    if (entry.deviceStoreId !== deviceStoreId) continue;
    entry.record.status = "disconnected";
    entry.record.lastSeen = now();
    emitStatus(entry.record);
    if (entry.socket.readyState === WebSocket.OPEN) {
      entry.socket.close(4003, "device revoked");
    }
  }
}

export function registerInboundAgent(socket: WebSocket, address: string, deviceStoreId?: string) {
  const id = uuid();
  const entry: AgentEntry = {
    socket,
    deviceStoreId,
    record: {
      id,
      connectionId: uuid(),
      address,
      status: "connecting",
      lastSeen: now(),
    },
  };
  agents.set(id, entry);
  emitStatus(entry.record);

  socket.on("message", (data: RawData) => {
    const raw = data.toString();
    if (raw.length > MAX_AGENT_MESSAGE_BYTES) {
      console.warn(`[agent inbound] oversized message from ${address}, closing`);
      socket.close(1009, "message too large");
      return;
    }

    let payload: AgentMessage;
    try {
      payload = JSON.parse(raw) as AgentMessage;
    } catch {
      console.warn(`[agent inbound] malformed message from ${address}`);
      return;
    }

    entry.record.lastSeen = now();

    switch (payload.type) {
      case "hello": {
        const deviceId = payload.agentId;
        if (activeAgentFor(deviceId, id)) {
          entry.record.status = "disconnected";
          entry.record.lastSeen = now();
          if (socket.readyState === WebSocket.OPEN) {
            socket.close(4001, "agent already connected (keeping first session)");
          }
          emitStatus(entry.record);
          return;
        }
        entry.record.status = "connected";
        entry.record.deviceId = deviceId;
        entry.record.fingerprint = payload.fingerprint;
        entry.record.agentVersion = payload.agentVersion;
        socket.send(JSON.stringify({ type: "hello" } satisfies ControlMessage));
        emitStatus(entry.record);
        requestDockerInfo(id);
        requestSystemInfo(id);
        requestNetworkInfo(id);
        return;
      }
      case "output": {
        emitOutput(id, payload);
        // Terminal output is the operator's shell content: command lines,
        // secrets they echo, file contents. It never goes to the server log
        // unless a developer explicitly opts in.
        if (DEBUG_TERMINAL) {
          const summary = summarizeOutput(payload.data);
          if (summary) {
            const label = entry.record.deviceId ?? entry.record.id;
            console.log(`[agent ${label}] ${summary}`);
          }
        }
        return;
      }
      case "heartbeat":
        entry.record.status = "connected";
        return;
      case "dockerInfo":
        entry.record.docker = payload.containers ?? [];
        entry.record.dockerError = payload.error;
        emitStatus(entry.record);
        return;
      case "systemInfo":
        entry.record.systemInfo = payload.systemInfo;
        entry.record.systemInfoError = payload.error;
        emitStatus(entry.record);
        return;
      case "networkInfo":
        entry.record.networkInfo = payload.networkInfo;
        entry.record.networkInfoError = payload.error;
        emitStatus(entry.record);
        return;
    }
  });

  socket.on("close", () => {
    entry.record.status = "disconnected";
    entry.record.lastSeen = now();
    emitStatus(entry.record);
    console.log(`[agent inbound] closed ${address} (id=${id})`);
  });

  socket.on("error", (err: Error) => {
    entry.record.status = "disconnected";
    entry.record.lastSeen = now();
    emitStatus(entry.record);
    console.warn(`[agent inbound] error ${address} (id=${id}): ${err.message}`);
  });
}

function activeAgentFor(deviceId: string | undefined, currentId: string) {
  if (!deviceId) return undefined;
  for (const [id, entry] of agents.entries()) {
    if (id === currentId) continue;
    if (entry.record.deviceId === deviceId && entry.record.status !== "disconnected") {
      return { id, entry };
    }
  }
  return undefined;
}

function requestInfo(agentId: string, type: "dockerInfo" | "systemInfo" | "networkInfo") {
  try {
    pushToAgent(agentId, { type });
  } catch (err) {
    console.warn(`[${type}] unable to request from agent ${agentId}: ${(err as Error).message}`);
  }
}

export const requestDockerInfo = (agentId: string) => requestInfo(agentId, "dockerInfo");
export const requestSystemInfo = (agentId: string) => requestInfo(agentId, "systemInfo");
export const requestNetworkInfo = (agentId: string) => requestInfo(agentId, "networkInfo");

function refreshAll(type: "dockerInfo" | "systemInfo" | "networkInfo") {
  for (const [id, entry] of agents.entries()) {
    if (entry.record.status === "connected") requestInfo(id, type);
  }
}

export const refreshAllDockerInfo = () => refreshAll("dockerInfo");
export const refreshAllSystemInfo = () => refreshAll("systemInfo");
export const refreshAllNetworkInfo = () => refreshAll("networkInfo");

const STALE_THRESHOLD_MS = 90_000;
const SWEEP_INTERVAL_MS = 60_000;

function sweepStaleAgents() {
  const cutoff = now() - STALE_THRESHOLD_MS;
  for (const [id, entry] of agents.entries()) {
    if (entry.record.status !== "connected") continue;
    if (entry.record.lastSeen < cutoff) {
      console.log(`[sweep] evicting stale agent ${id}`);
      entry.record.status = "disconnected";
      entry.record.lastSeen = now();
      if (entry.socket.readyState === WebSocket.OPEN) {
        entry.socket.close(4002, "heartbeat timeout");
      }
      emitStatus(entry.record);
    }
  }
}

export function startStaleAgentSweep() {
  return setInterval(sweepStaleAgents, SWEEP_INTERVAL_MS);
}

/** Test seam: clears the registry. */
export function resetAgentsForTest() {
  agents.clear();
}
