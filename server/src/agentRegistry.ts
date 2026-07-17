import WebSocket, { type RawData } from "ws";
import {
  canonicalAgentRecordFor,
  listAgentRecords,
  markDeviceSeen,
  recordDeviceConnected,
  recordDeviceDisconnected,
  updateDeviceRuntime,
} from "./deviceStore";
import { summarizeOutput } from "./utils/output";
import { type AgentMessage, type AgentRecord, type ControlMessage } from "./types";

/**
 * Live connection tracking.
 *
 * Device details and status live in SQLite (see deviceStore); this module only
 * holds the open sockets, keyed by the device's credential id. A reconnect
 * reuses the same device row rather than creating a new one, so devices no
 * longer appear twice — once "connected" and once "disconnected".
 */

type LiveConnection = {
  socket: WebSocket;
  deviceStoreId: string;
  connectionId: string;
  identity: string;
};

// Keyed by credential id (deviceStoreId) so a same-key reconnect replaces its
// own entry. identityToStoreId enforces one live socket per physical device.
const connections: Map<string, LiveConnection> = new Map();
const identityToStoreId: Map<string, string> = new Map();

const statusListeners: Set<(record: AgentRecord) => void> = new Set();
const outputListeners: Set<(agentId: string, payload: AgentMessage) => void> = new Set();

const MAX_AGENT_MESSAGE_BYTES = 256 * 1024;
const DEBUG_TERMINAL = process.env.SPECTRE_DEBUG_TERMINAL === "1";

export type AgentDependencies = {
  listAgents: () => AgentRecord[];
  pushToAgent: (id: string, message: ControlMessage) => void;
  refreshDockerInfo?: () => void;
  refreshSystemInfo?: () => void;
  refreshNetworkInfo?: () => void;
};

export function onAgentStatusChange(listener: (record: AgentRecord) => void) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function onAgentOutput(listener: (agentId: string, payload: AgentMessage) => void) {
  outputListeners.add(listener);
  return () => outputListeners.delete(listener);
}

function emitOutput(agentId: string, payload: AgentMessage) {
  for (const listener of outputListeners) listener(agentId, payload);
}

/** Emits the canonical (deduped) record for whichever device this row belongs to. */
function emitDeviceUpdate(deviceStoreId: string) {
  const record = canonicalAgentRecordFor(deviceStoreId);
  if (!record) return;
  for (const listener of statusListeners) listener(record);
}

export function listAgents(): AgentRecord[] {
  return listAgentRecords();
}

/** Resolves the device shown in the UI for a given id (used by the terminal WS). */
export function currentAgent(agentId: string): { record: AgentRecord } | undefined {
  const record = canonicalAgentRecordFor(agentId);
  return record ? { record } : undefined;
}

export function pushToAgent(agentId: string, message: ControlMessage) {
  const conn = connections.get(agentId);
  if (!conn || conn.socket.readyState !== WebSocket.OPEN) {
    throw new Error("agent not connected");
  }
  conn.socket.send(JSON.stringify(message));
}

/** Drops every live connection belonging to a device (used on revoke). */
export function disconnectDevice(deviceStoreId: string) {
  for (const conn of connections.values()) {
    if (conn.deviceStoreId !== deviceStoreId) continue;
    if (conn.socket.readyState === WebSocket.OPEN) {
      conn.socket.close(4003, "device revoked");
    }
  }
}

export function registerInboundAgent(socket: WebSocket, address: string, deviceStoreId?: string) {
  // Enrollment always resolves a device row before the socket is accepted.
  if (!deviceStoreId) {
    socket.close(4401, "unidentified device");
    return;
  }

  let connectionId: string | null = null;

  socket.on("message", (data: RawData) => {
    const raw = data.toString();
    if (raw.length > MAX_AGENT_MESSAGE_BYTES) {
      console.warn(`[agent] oversized message from ${address}, closing`);
      socket.close(1009, "message too large");
      return;
    }

    let payload: AgentMessage;
    try {
      payload = JSON.parse(raw) as AgentMessage;
    } catch {
      console.warn(`[agent] malformed message from ${address}`);
      return;
    }

    switch (payload.type) {
      case "hello": {
        const { connectionId: cid, identity } = recordDeviceConnected(deviceStoreId, {
          address,
          agentDeviceId: payload.agentId,
          agentVersion: payload.agentVersion,
          fingerprint: payload.fingerprint,
        });
        connectionId = cid;

        // One live socket per physical device: if this machine already had a
        // connection (a ghost from a dropped link, or a duplicate agent), close
        // the old one and let the newest win.
        const previousStoreId = identityToStoreId.get(identity);
        if (previousStoreId && previousStoreId !== deviceStoreId) {
          connections.get(previousStoreId)?.socket.close(4004, "superseded by newer connection");
          connections.delete(previousStoreId);
        }
        const sameKeyGhost = connections.get(deviceStoreId);
        if (sameKeyGhost && sameKeyGhost.socket !== socket && sameKeyGhost.socket.readyState === WebSocket.OPEN) {
          sameKeyGhost.socket.close(4004, "superseded by newer connection");
        }

        connections.set(deviceStoreId, { socket, deviceStoreId, connectionId: cid, identity });
        identityToStoreId.set(identity, deviceStoreId);

        socket.send(JSON.stringify({ type: "hello" } satisfies ControlMessage));
        emitDeviceUpdate(deviceStoreId);
        requestDockerInfo(deviceStoreId);
        requestSystemInfo(deviceStoreId);
        requestNetworkInfo(deviceStoreId);
        return;
      }
      case "output": {
        emitOutput(deviceStoreId, payload);
        if (DEBUG_TERMINAL) {
          const summary = summarizeOutput(payload.data);
          if (summary) console.log(`[agent ${deviceStoreId}] ${summary}`);
        }
        return;
      }
      case "heartbeat":
        markDeviceSeen(deviceStoreId);
        return;
      case "dockerInfo":
        updateDeviceRuntime(deviceStoreId, { docker: payload.containers ?? [] });
        emitDeviceUpdate(deviceStoreId);
        return;
      case "systemInfo":
        if (payload.systemInfo) updateDeviceRuntime(deviceStoreId, { systemInfo: payload.systemInfo });
        emitDeviceUpdate(deviceStoreId);
        return;
      case "networkInfo":
        if (payload.networkInfo) updateDeviceRuntime(deviceStoreId, { networkInfo: payload.networkInfo });
        emitDeviceUpdate(deviceStoreId);
        return;
    }
  });

  const teardown = (reason: string) => {
    // Only tear down if this socket is still the current one for the device; a
    // newer connection may have already replaced it.
    const current = connections.get(deviceStoreId);
    if (current && current.socket !== socket) return;

    if (connectionId) recordDeviceDisconnected(deviceStoreId, connectionId, reason);
    else recordDeviceDisconnected(deviceStoreId, "", reason);

    connections.delete(deviceStoreId);
    const conn = current;
    if (conn && identityToStoreId.get(conn.identity) === deviceStoreId) {
      identityToStoreId.delete(conn.identity);
    }
    emitDeviceUpdate(deviceStoreId);
  };

  socket.on("close", () => {
    console.log(`[agent] closed ${address} (device=${deviceStoreId})`);
    teardown("connection closed");
  });

  socket.on("error", (err: Error) => {
    console.warn(`[agent] error ${address} (device=${deviceStoreId}): ${err.message}`);
    teardown(err.message);
  });
}

function requestInfo(agentId: string, type: "dockerInfo" | "systemInfo" | "networkInfo") {
  try {
    pushToAgent(agentId, { type });
  } catch (err) {
    console.warn(`[${type}] unable to request from ${agentId}: ${(err as Error).message}`);
  }
}

export const requestDockerInfo = (agentId: string) => requestInfo(agentId, "dockerInfo");
export const requestSystemInfo = (agentId: string) => requestInfo(agentId, "systemInfo");
export const requestNetworkInfo = (agentId: string) => requestInfo(agentId, "networkInfo");

function refreshAll(type: "dockerInfo" | "systemInfo" | "networkInfo") {
  for (const id of connections.keys()) requestInfo(id, type);
}

export const refreshAllDockerInfo = () => refreshAll("dockerInfo");
export const refreshAllSystemInfo = () => refreshAll("systemInfo");
export const refreshAllNetworkInfo = () => refreshAll("networkInfo");

const STALE_THRESHOLD_MS = 90_000;
const SWEEP_INTERVAL_MS = 60_000;

function sweepStaleAgents() {
  const cutoff = Date.now() - STALE_THRESHOLD_MS;
  for (const record of listAgentRecords()) {
    if (record.status !== "connected") continue;
    if (record.lastSeen < cutoff) {
      const conn = connections.get(record.id);
      if (conn && conn.socket.readyState === WebSocket.OPEN) {
        console.log(`[sweep] evicting stale agent ${record.id}`);
        conn.socket.close(4002, "heartbeat timeout");
      }
    }
  }
}

export function startStaleAgentSweep() {
  return setInterval(sweepStaleAgents, SWEEP_INTERVAL_MS);
}

/** Test seam: closes all live sockets and clears the maps. */
export function resetAgentsForTest() {
  for (const conn of connections.values()) {
    try {
      conn.socket.close();
    } catch {
      /* ignore */
    }
  }
  connections.clear();
  identityToStoreId.clear();
}
