import {
  type AgentFingerprint,
  type AgentRecord,
  type ConnectionRecord,
  type DockerContainer,
  type NetworkInfo,
  type SystemInfo,
} from "../types";
import { getDb } from "../db";
import { lastConnectedAtFor, lastConnectedIndex } from "./accessHistory";
import { deviceStoreIdsFor } from "./mutations";
import { type DeviceRow, type PublicDevice, parseJson } from "./types";

/**
 * Resolves a row's "last connected" from a prebuilt index, preferring the
 * identity group so every credential row for one machine agrees.
 */
type LastConnectedLookup = (row: DeviceRow) => number | undefined;

function indexedLookup(): LastConnectedLookup {
  const { byIdentity, byDevice } = lastConnectedIndex();
  return (row) => (row.identity ? byIdentity.get(row.identity) : undefined) ?? byDevice.get(row.id);
}

// --- Reads: device lists ---------------------------------------------------

/**
 * All non-revoked devices, collapsed to one row per physical machine.
 *
 * Multiple credential rows can share an identity (a machine re-enrolled with a
 * new key); we keep the most relevant one — connected first, then most recently
 * seen — so the UI shows a single entry that flips between connected and
 * disconnected instead of two.
 */
function canonicalRows(): DeviceRow[] {
  const rows = getDb().prepare("SELECT * FROM devices WHERE revoked_at IS NULL").all() as DeviceRow[];
  const best = new Map<string, DeviceRow>();
  const rank = (r: DeviceRow) => (r.status === "connected" ? 1 : 0);

  for (const row of rows) {
    const key = row.identity && row.identity.length > 0 ? row.identity : `id:${row.id}`;
    const current = best.get(key);
    if (
      !current ||
      rank(row) > rank(current) ||
      (rank(row) === rank(current) && row.last_seen > current.last_seen)
    ) {
      best.set(key, row);
    }
  }
  return Array.from(best.values());
}

function rowToAgentRecord(row: DeviceRow, lastConnectedAt?: number): AgentRecord {
  return {
    id: row.id,
    connectionId: row.id,
    address: row.last_address ?? "",
    lastConnectedAt,
    // first_seen is stamped on the device's first hello. A row that has one but
    // no live socket has genuinely dropped; one without has only just been
    // issued a credential and is still on its way in, which is not the same
    // thing and should not read as a dead machine.
    status: row.status === "connected" ? "connected" : row.first_seen ? "disconnected" : "connecting",
    lastSeen: row.last_seen,
    deviceId: row.agent_device_id ?? undefined,
    identity: row.identity ?? undefined,
    name: row.name ?? undefined,
    enrolledAt: row.enrolled_at,
    firstSeen: row.first_seen ?? undefined,
    agentVersion: row.agent_version ?? undefined,
    fingerprint: parseJson<AgentFingerprint>(row.fingerprint),
    docker: parseJson<DockerContainer[]>(row.docker),
    systemInfo: parseJson<SystemInfo>(row.system_info),
    networkInfo: parseJson<NetworkInfo>(row.network_info),
  };
}

/** For the dashboard: one AgentRecord per physical device. */
export function listAgentRecords(): AgentRecord[] {
  const lookup = indexedLookup();
  return canonicalRows()
    .map((row) => rowToAgentRecord(row, lookup(row)))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * The AgentRecord the dashboard should show for the device a given credential
 * row belongs to — the best row in its identity group. The registry emits this
 * after any change so a reconnect updates one entry instead of adding another.
 */
export function canonicalAgentRecordFor(deviceStoreId: string): AgentRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceStoreId) as DeviceRow | undefined;
  if (!row) return null;
  // A single row: one targeted lookup rather than indexing the whole table.
  const withAccess = (r: DeviceRow) => rowToAgentRecord(r, lastConnectedAtFor(r.id, r.identity));
  if (!row.identity) return withAccess(row);

  const rows = db.prepare("SELECT * FROM devices WHERE identity = ? AND revoked_at IS NULL").all(row.identity) as DeviceRow[];
  if (rows.length === 0) return withAccess(row);

  const rank = (r: DeviceRow) => (r.status === "connected" ? 1 : 0);
  let best = rows[0];
  for (const r of rows) {
    if (rank(r) > rank(best) || (rank(r) === rank(best) && r.last_seen > best.last_seen)) best = r;
  }
  return withAccess(best);
}

/** For device management: one PublicDevice per physical device. */
export function listDevices(): PublicDevice[] {
  const lookup = indexedLookup();
  return canonicalRows()
    .map((row) => rowToPublicDevice(row, lookup(row)))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

function rowToPublicDevice(row: DeviceRow, lastConnectedAt?: number): PublicDevice {
  return {
    id: row.id,
    deviceId: row.agent_device_id ?? undefined,
    name: row.name ?? undefined,
    hostname: row.hostname ?? undefined,
    status: row.status === "connected" ? "connected" : "disconnected",
    enrolledAt: row.enrolled_at,
    firstSeen: row.first_seen ?? undefined,
    lastSeen: row.last_seen,
    lastConnectedAt,
    revoked: Boolean(row.revoked_at),
  };
}

export function getPublicDevice(id: string): PublicDevice | null {
  const row = getDb().prepare("SELECT * FROM devices WHERE id = ?").get(id) as DeviceRow | undefined;
  return row ? rowToPublicDevice(row, lastConnectedAtFor(row.id, row.identity)) : null;
}

// --- Connection history ----------------------------------------------------

export function listConnections(deviceId: string, limit = 50): ConnectionRecord[] {
  // Show the whole identity group's history, not just this credential row's.
  const ids = deviceStoreIdsFor(deviceId);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT * FROM connections WHERE device_id IN (${placeholders}) ORDER BY connected_at DESC LIMIT ?`,
    )
    .all(...ids, limit) as Array<{
    id: string;
    device_id: string;
    address: string | null;
    connected_at: number;
    disconnected_at: number | null;
    close_reason: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    deviceId: r.device_id,
    address: r.address ?? undefined,
    connectedAt: r.connected_at,
    disconnectedAt: r.disconnected_at ?? undefined,
    closeReason: r.close_reason ?? undefined,
  }));
}
