import WebSocket from "ws";
import { listAgentRecords } from "../deviceStore";
import { type ControlMessage } from "../types";

/**
 * Live connection tracking.
 *
 * Device details and status live in SQLite (see deviceStore); this module only
 * holds the open sockets, keyed by the device's credential id. A reconnect
 * reuses the same device row rather than creating a new one, so devices no
 * longer appear twice — once "connected" and once "disconnected".
 */

export type LiveConnection = {
  socket: WebSocket;
  deviceStoreId: string;
  connectionId: string;
  identity: string;
};

// Keyed by credential id (deviceStoreId) so a same-key reconnect replaces its
// own entry. identityToStoreId enforces one live socket per physical device.
export const connections: Map<string, LiveConnection> = new Map();
export const identityToStoreId: Map<string, string> = new Map();

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
