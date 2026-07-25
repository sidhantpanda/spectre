import { v4 as uuid } from "uuid";
import {
  type AgentFingerprint,
  type DockerContainer,
  type NetworkInfo,
  type SystemInfo,
} from "../types";
import { getDb } from "../db";
import { computeIdentity } from "./identity";
import { now } from "./internal";

// --- Devices: runtime state (driven by the registry) -----------------------

/**
 * Records that a device connected. Resolves and stores its stable identity and
 * the details it reported, and opens a row in the connection history.
 * Returns the connection id (to close later).
 */
export function recordDeviceConnected(
  deviceStoreId: string,
  info: {
    address: string;
    agentDeviceId?: string;
    agentVersion?: string;
    fingerprint?: AgentFingerprint;
  },
): { connectionId: string; identity: string } {
  const db = getDb();
  const ts = now();
  const { identity, machineId, primaryMac } = computeIdentity(info.fingerprint, info.agentDeviceId);

  const existing = db.prepare("SELECT first_seen FROM devices WHERE id = ?").get(deviceStoreId) as
    | { first_seen: number | null }
    | undefined;
  const firstSeen = existing?.first_seen ?? ts;

  db.prepare(
    `UPDATE devices SET
       status = 'connected',
       identity = ?,
       agent_device_id = COALESCE(?, agent_device_id),
       machine_id = ?,
       primary_mac = ?,
       mac_addresses = ?,
       hostname = ?,
       fingerprint = ?,
       agent_version = ?,
       last_address = ?,
       first_seen = ?,
       last_seen = ?
     WHERE id = ?`,
  ).run(
    identity || null,
    info.agentDeviceId ?? null,
    machineId ?? null,
    primaryMac ?? null,
    info.fingerprint ? JSON.stringify(info.fingerprint.macAddresses ?? []) : null,
    info.fingerprint?.hostname ?? null,
    info.fingerprint ? JSON.stringify(info.fingerprint) : null,
    info.agentVersion ?? null,
    info.address,
    firstSeen,
    ts,
    deviceStoreId,
  );

  const connectionId = uuid();
  db.prepare(
    "INSERT INTO connections (id, device_id, identity, address, connected_at) VALUES (?, ?, ?, ?, ?)",
  ).run(connectionId, deviceStoreId, identity || null, info.address, ts);

  return { connectionId, identity };
}

export function recordDeviceDisconnected(deviceStoreId: string, connectionId: string, reason?: string): void {
  const db = getDb();
  const ts = now();
  db.prepare("UPDATE devices SET status = 'disconnected', last_seen = ? WHERE id = ?").run(ts, deviceStoreId);
  db.prepare("UPDATE connections SET disconnected_at = ?, close_reason = ? WHERE id = ? AND disconnected_at IS NULL").run(
    ts,
    reason ?? null,
    connectionId,
  );
}

export function markDeviceSeen(deviceStoreId: string): void {
  getDb().prepare("UPDATE devices SET last_seen = ? WHERE id = ?").run(now(), deviceStoreId);
}

export function updateDeviceRuntime(
  deviceStoreId: string,
  updates: {
    systemInfo?: SystemInfo;
    networkInfo?: NetworkInfo;
    docker?: DockerContainer[];
  },
): void {
  const db = getDb();
  if (updates.systemInfo !== undefined) {
    db.prepare("UPDATE devices SET system_info = ? WHERE id = ?").run(JSON.stringify(updates.systemInfo), deviceStoreId);
  }
  if (updates.networkInfo !== undefined) {
    db.prepare("UPDATE devices SET network_info = ? WHERE id = ?").run(JSON.stringify(updates.networkInfo), deviceStoreId);
  }
  if (updates.docker !== undefined) {
    db.prepare("UPDATE devices SET docker = ? WHERE id = ?").run(JSON.stringify(updates.docker), deviceStoreId);
  }
}
