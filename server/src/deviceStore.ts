import { createHash, randomBytes, randomInt } from "crypto";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { closeDatabase, getDb, openDatabase } from "./db";
import {
  type AgentFingerprint,
  type AgentRecord,
  type ConnectionRecord,
  type DockerContainer,
  type NetworkInfo,
  type SystemInfo,
} from "./types";

/**
 * Persistent store, backed by SQLite.
 *
 * Credentials (auth keys, device keys) are stored only as SHA-256 hashes:
 * reading the database file must not be enough to impersonate a device or enrol
 * a new one. A secret's plaintext is returned exactly once, when it is created.
 * These are high-entropy random tokens, so a fast hash is the right choice.
 *
 * A device is identified by stable hardware attributes (machine-id, then MAC),
 * so a machine that disconnects and reconnects — or is re-enrolled with a new
 * key — maps to a single row rather than accumulating duplicates.
 */

export interface DeviceRecord {
  id: string;
  keyHash: string;
  deviceId?: string;
  name?: string;
  enrolledAt: number;
  lastSeen: number;
  revokedAt?: number;
}

export interface PublicDevice {
  id: string;
  deviceId?: string;
  name?: string;
  hostname?: string;
  status: "connected" | "disconnected";
  enrolledAt: number;
  firstSeen?: number;
  lastSeen: number;
  revoked: boolean;
}

export interface PublicAuthKey {
  id: string;
  hint: string;
  description?: string;
  reusable: boolean;
  createdAt: number;
  expiresAt: number;
  uses: number;
  revoked: boolean;
}

export interface PublicPendingDevice {
  id: string;
  userCode: string;
  hostname?: string;
  createdAt: number;
  expiresAt: number;
}

const AUTH_KEY_PREFIX = "sk_";
const DEVICE_KEY_PREFIX = "dk_";
const PENDING_TTL_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Omits characters that are easy to misread out loud or in a terminal font.
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";

let initialized = false;

/**
 * Device keys issued by an approval, waiting for the agent to collect them.
 * In memory only and never persisted: this is the one moment a plaintext device
 * key exists server-side, and persisting it would break the guarantee that the
 * database contains nothing usable. A restart mid-approval just expires it.
 */
const issuedKeys: Map<string, string> = new Map();

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function now(): number {
  return Date.now();
}

// --- Row types and JSON helpers --------------------------------------------

interface DeviceRow {
  id: string;
  key_hash: string;
  identity: string | null;
  agent_device_id: string | null;
  machine_id: string | null;
  primary_mac: string | null;
  mac_addresses: string | null;
  hostname: string | null;
  name: string | null;
  fingerprint: string | null;
  agent_version: string | null;
  system_info: string | null;
  network_info: string | null;
  docker: string | null;
  status: string;
  last_address: string | null;
  enrolled_at: number;
  first_seen: number | null;
  last_seen: number;
  revoked_at: number | null;
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

// --- Initialization --------------------------------------------------------

export function initDeviceStore(dataDir: string) {
  openDatabase(dataDir);
  importLegacyJson(dataDir);
  initialized = true;
  prune();
  // Nothing can be connected across a restart until agents redial, so no row
  // should linger as "connected".
  getDb().prepare("UPDATE devices SET status = 'disconnected' WHERE status = 'connected'").run();
  getDb()
    .prepare("UPDATE connections SET disconnected_at = ?, close_reason = 'server restart' WHERE disconnected_at IS NULL")
    .run(now());
}

export function isInitialized() {
  return initialized;
}

/**
 * One-time import of the pre-SQLite JSON store, so existing enrollments and auth
 * keys survive the upgrade. The old file is renamed aside once imported.
 */
function importLegacyJson(dataDir: string) {
  const legacyPath = path.join(dataDir, "store.json");
  if (!fs.existsSync(legacyPath)) return;

  const db = getDb();
  const existing = db.prepare("SELECT COUNT(*) AS n FROM devices").get() as { n: number };
  if (existing.n > 0) return; // already populated; don't re-import

  try {
    const parsed = JSON.parse(fs.readFileSync(legacyPath, "utf-8")) as {
      devices?: Array<{ id: string; keyHash: string; deviceId?: string; name?: string; enrolledAt?: number; lastSeen?: number; revokedAt?: number }>;
      authKeys?: Array<{ id: string; keyHash: string; hint: string; description?: string; reusable?: boolean; createdAt?: number; expiresAt?: number; uses?: number; revokedAt?: number }>;
    };

    const insertDevice = db.prepare(
      `INSERT OR IGNORE INTO devices (id, key_hash, agent_device_id, name, status, enrolled_at, last_seen, revoked_at)
       VALUES (?, ?, ?, ?, 'disconnected', ?, ?, ?)`,
    );
    for (const d of parsed.devices ?? []) {
      insertDevice.run(d.id, d.keyHash, d.deviceId ?? null, d.name ?? null, d.enrolledAt ?? now(), d.lastSeen ?? now(), d.revokedAt ?? null);
    }

    const insertKey = db.prepare(
      `INSERT OR IGNORE INTO auth_keys (id, key_hash, hint, description, reusable, created_at, expires_at, uses, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const k of parsed.authKeys ?? []) {
      insertKey.run(k.id, k.keyHash, k.hint, k.description ?? null, k.reusable ? 1 : 0, k.createdAt ?? now(), k.expiresAt ?? now(), k.uses ?? 0, k.revokedAt ?? null);
    }

    fs.renameSync(legacyPath, legacyPath + ".imported");
    console.log(`Imported ${parsed.devices?.length ?? 0} device(s) and ${parsed.authKeys?.length ?? 0} auth key(s) from store.json`);
  } catch (err) {
    console.warn(`Could not import legacy store.json: ${(err as Error).message}`);
  }
}

// Machines waiting for approval are shown live on the dashboard, so anything
// that adds, approves, denies or expires one has to say so.
const pendingListeners: Set<() => void> = new Set();

export function onPendingDevicesChange(listener: () => void) {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}

function emitPendingChange() {
  for (const listener of pendingListeners) listener();
}

/** Drops expired pending enrollments and spent-and-expired auth keys. */
export function prune() {
  if (!initialized) return;
  const db = getDb();
  const ts = now();

  const expired = db.prepare("SELECT id FROM pending_devices WHERE expires_at <= ? OR claimed = 1").all(ts) as { id: string }[];
  for (const row of expired) issuedKeys.delete(row.id);

  const dropped = db.prepare("DELETE FROM pending_devices WHERE expires_at <= ? OR claimed = 1").run(ts);
  db.prepare("DELETE FROM auth_keys WHERE expires_at <= ? AND uses = 0").run(ts);
  // prune() runs from inside the pending reads, so only announce a real change.
  if (Number(dropped.changes) > 0) emitPendingChange();
}

// --- Device identity -------------------------------------------------------

/**
 * Derives a stable identity for a machine from what the agent reports.
 *
 * Precedence, most stable first: the Linux machine-id, then the sorted set of
 * MAC addresses (order-independent), then the agent's persistent device id.
 * This is what makes a reconnect — or a re-enrollment with a fresh key — resolve
 * to the same device instead of a new one.
 */
export function computeIdentity(
  fingerprint: AgentFingerprint | undefined,
  agentDeviceId: string | undefined,
): { identity: string; machineId?: string; primaryMac?: string } {
  const machineId = fingerprint?.machineId?.trim();
  const macs = (fingerprint?.macAddresses ?? [])
    .map((m) => m.trim().toLowerCase())
    .filter((m) => m.length > 0 && m !== "00:00:00:00:00:00")
    .sort();
  const primaryMac = macs[0];

  if (machineId) return { identity: `mid:${machineId}`, machineId, primaryMac };
  if (macs.length > 0) return { identity: `mac:${macs.join(",")}`, primaryMac };
  if (agentDeviceId) return { identity: `aid:${agentDeviceId}`, primaryMac };
  return { identity: "", primaryMac };
}

// --- Auth keys -------------------------------------------------------------

export function createAuthKey(options: { reusable?: boolean; expiresInMs?: number; description?: string } = {}): {
  key: string;
  record: PublicAuthKey;
} {
  const ts = now();
  const key = AUTH_KEY_PREFIX + randomBytes(24).toString("hex");
  const id = uuid();
  const expiresAt = ts + (options.expiresInMs ?? DEFAULT_AUTH_KEY_TTL_MS);
  getDb()
    .prepare(
      `INSERT INTO auth_keys (id, key_hash, hint, description, reusable, created_at, expires_at, uses)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(id, hash(key), key.slice(0, AUTH_KEY_PREFIX.length + 6), options.description ?? null, options.reusable ? 1 : 0, ts, expiresAt);

  return {
    key,
    record: {
      id,
      hint: key.slice(0, AUTH_KEY_PREFIX.length + 6),
      description: options.description,
      reusable: Boolean(options.reusable),
      createdAt: ts,
      expiresAt,
      uses: 0,
      revoked: false,
    },
  };
}

interface AuthKeyRow {
  id: string;
  reusable: number;
  expires_at: number;
  uses: number;
  revoked_at: number | null;
}

export function redeemAuthKey(key: string, deviceId?: string): { device: DeviceRecord; deviceKey: string } | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM auth_keys WHERE key_hash = ?").get(hash(key)) as AuthKeyRow | undefined;
  if (!row) return null;
  if (row.revoked_at) return null;
  if (now() > row.expires_at) return null;
  if (!row.reusable && row.uses > 0) return null;

  db.prepare("UPDATE auth_keys SET uses = uses + 1 WHERE id = ?").run(row.id);
  return createDevice(deviceId);
}

export function listAuthKeys(): PublicAuthKey[] {
  const rows = getDb().prepare("SELECT * FROM auth_keys ORDER BY created_at DESC").all() as Array<{
    id: string;
    hint: string;
    description: string | null;
    reusable: number;
    created_at: number;
    expires_at: number;
    uses: number;
    revoked_at: number | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    hint: r.hint,
    description: r.description ?? undefined,
    reusable: Boolean(r.reusable),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    uses: r.uses,
    revoked: Boolean(r.revoked_at),
  }));
}

export function revokeAuthKey(id: string): boolean {
  const res = getDb().prepare("UPDATE auth_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now(), id);
  return Number(res.changes) > 0;
}

// --- Interactive approval --------------------------------------------------

function generateUserCode(): string {
  const pick = () => Array.from({ length: 4 }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

export function createPendingDevice(info: { hostname?: string; deviceId?: string }): {
  userCode: string;
  pollToken: string;
  expiresAt: number;
} {
  prune();
  const db = getDb();
  const ts = now();
  const pollToken = randomBytes(32).toString("hex");

  let userCode = generateUserCode();
  while (db.prepare("SELECT 1 FROM pending_devices WHERE user_code = ?").get(userCode)) {
    userCode = generateUserCode();
  }

  const expiresAt = ts + PENDING_TTL_MS;
  db.prepare(
    `INSERT INTO pending_devices (id, user_code, poll_token_hash, hostname, device_id, created_at, expires_at, claimed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(uuid(), userCode, hash(pollToken), info.hostname ?? null, info.deviceId ?? null, ts, expiresAt);

  emitPendingChange();
  return { userCode, pollToken, expiresAt };
}

export type PollResult =
  | { status: "pending" }
  | { status: "approved"; deviceKey: string }
  | { status: "expired" };

export function pollPendingDevice(pollToken: string): PollResult {
  const db = getDb();
  const row = db.prepare("SELECT * FROM pending_devices WHERE poll_token_hash = ?").get(hash(pollToken)) as
    | { id: string; expires_at: number; approved_at: number | null }
    | undefined;
  if (!row) return { status: "expired" };
  if (now() > row.expires_at) return { status: "expired" };
  if (!row.approved_at) return { status: "pending" };

  const deviceKey = issuedKeys.get(row.id);
  if (!deviceKey) return { status: "expired" };

  issuedKeys.delete(row.id);
  db.prepare("UPDATE pending_devices SET claimed = 1 WHERE id = ?").run(row.id);
  db.prepare("DELETE FROM pending_devices WHERE id = ?").run(row.id);
  return { status: "approved", deviceKey };
}

export function listPendingDevices(): PublicPendingDevice[] {
  prune();
  const rows = getDb()
    .prepare("SELECT id, user_code, hostname, created_at, expires_at FROM pending_devices WHERE approved_at IS NULL ORDER BY created_at DESC")
    .all() as Array<{ id: string; user_code: string; hostname: string | null; created_at: number; expires_at: number }>;
  return rows.map((r) => ({
    id: r.id,
    userCode: r.user_code,
    hostname: r.hostname ?? undefined,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

export function approvePendingDevice(userCode: string, name?: string): PublicDevice | null {
  prune();
  const db = getDb();
  const normalized = userCode.trim().toUpperCase();
  const row = db.prepare("SELECT * FROM pending_devices WHERE user_code = ? AND approved_at IS NULL").get(normalized) as
    | { id: string; expires_at: number; hostname: string | null; device_id: string | null }
    | undefined;
  if (!row) return null;
  if (now() > row.expires_at) return null;

  const { device, deviceKey } = createDevice(row.device_id ?? undefined);
  const deviceName = name ?? row.hostname ?? undefined;
  if (deviceName) {
    db.prepare("UPDATE devices SET name = ? WHERE id = ?").run(deviceName, device.id);
  }
  db.prepare("UPDATE pending_devices SET approved_at = ? WHERE id = ?").run(now(), row.id);
  issuedKeys.set(row.id, deviceKey);

  emitPendingChange();
  return getPublicDevice(device.id)!;
}

export function denyPendingDevice(userCode: string): boolean {
  const db = getDb();
  const normalized = userCode.trim().toUpperCase();
  const rows = db.prepare("SELECT id FROM pending_devices WHERE user_code = ?").all(normalized) as { id: string }[];
  if (rows.length === 0) return false;
  for (const r of rows) issuedKeys.delete(r.id);
  db.prepare("DELETE FROM pending_devices WHERE user_code = ?").run(normalized);
  emitPendingChange();
  return true;
}

// --- Devices: credentials --------------------------------------------------

function createDevice(deviceId?: string): { device: DeviceRecord; deviceKey: string } {
  const deviceKey = DEVICE_KEY_PREFIX + randomBytes(32).toString("hex");
  const id = uuid();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO devices (id, key_hash, agent_device_id, status, enrolled_at, last_seen)
       VALUES (?, ?, ?, 'disconnected', ?, ?)`,
    )
    .run(id, hash(deviceKey), deviceId ?? null, ts, ts);

  return { device: { id, keyHash: hash(deviceKey), deviceId, enrolledAt: ts, lastSeen: ts }, deviceKey };
}

export function findDeviceByKey(key: string): DeviceRecord | null {
  const row = getDb().prepare("SELECT * FROM devices WHERE key_hash = ?").get(hash(key)) as DeviceRow | undefined;
  if (!row || row.revoked_at) return null;
  return {
    id: row.id,
    keyHash: row.key_hash,
    deviceId: row.agent_device_id ?? undefined,
    name: row.name ?? undefined,
    enrolledAt: row.enrolled_at,
    lastSeen: row.last_seen,
    revokedAt: row.revoked_at ?? undefined,
  };
}

export function touchDevice(key: string, updates: { lastSeen?: number }): void {
  if (updates.lastSeen === undefined) return;
  getDb().prepare("UPDATE devices SET last_seen = ? WHERE key_hash = ?").run(updates.lastSeen, hash(key));
}

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

function rowToAgentRecord(row: DeviceRow): AgentRecord {
  return {
    id: row.id,
    connectionId: row.id,
    address: row.last_address ?? "",
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
  return canonicalRows()
    .map(rowToAgentRecord)
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
  if (!row.identity) return rowToAgentRecord(row);

  const rows = db.prepare("SELECT * FROM devices WHERE identity = ? AND revoked_at IS NULL").all(row.identity) as DeviceRow[];
  if (rows.length === 0) return rowToAgentRecord(row);

  const rank = (r: DeviceRow) => (r.status === "connected" ? 1 : 0);
  let best = rows[0];
  for (const r of rows) {
    if (rank(r) > rank(best) || (rank(r) === rank(best) && r.last_seen > best.last_seen)) best = r;
  }
  return rowToAgentRecord(best);
}

/** For device management: one PublicDevice per physical device. */
export function listDevices(): PublicDevice[] {
  return canonicalRows()
    .map(rowToPublicDevice)
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

function rowToPublicDevice(row: DeviceRow): PublicDevice {
  return {
    id: row.id,
    deviceId: row.agent_device_id ?? undefined,
    name: row.name ?? undefined,
    hostname: row.hostname ?? undefined,
    status: row.status === "connected" ? "connected" : "disconnected",
    enrolledAt: row.enrolled_at,
    firstSeen: row.first_seen ?? undefined,
    lastSeen: row.last_seen,
    revoked: Boolean(row.revoked_at),
  };
}

function getPublicDevice(id: string): PublicDevice | null {
  const row = getDb().prepare("SELECT * FROM devices WHERE id = ?").get(id) as DeviceRow | undefined;
  return row ? rowToPublicDevice(row) : null;
}

/**
 * Revokes a device. Because a physical device may hold several credential rows
 * (re-enrollments), every row sharing its identity is revoked, so no leftover
 * key keeps working.
 */
export function revokeDevice(id: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT identity FROM devices WHERE id = ?").get(id) as { identity: string | null } | undefined;
  if (!row) return false;

  const ts = now();
  if (row.identity) {
    const res = db.prepare("UPDATE devices SET revoked_at = ? WHERE identity = ? AND revoked_at IS NULL").run(ts, row.identity);
    return Number(res.changes) > 0;
  }
  const res = db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(ts, id);
  return Number(res.changes) > 0;
}

/**
 * Permanently removes a disconnected device and its connection history.
 *
 * Deletes every credential row in the identity group (a machine may hold more
 * than one key) along with its connection log, so the device disappears from
 * the dashboard entirely rather than lingering as a disconnected entry. Refuses
 * a device that is still connected — a live machine must be revoked, not
 * silently forgotten while its socket stays open.
 */
export function deleteDevice(id: string): "ok" | "not_found" | "connected" {
  const db = getDb();
  const ids = deviceStoreIdsFor(id);
  if (ids.length === 0) return "not_found";

  const placeholders = ids.map(() => "?").join(",");
  const connected = db
    .prepare(`SELECT 1 FROM devices WHERE id IN (${placeholders}) AND status = 'connected'`)
    .get(...ids);
  if (connected) return "connected";

  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM connections WHERE device_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM devices WHERE id IN (${placeholders})`).run(...ids);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return "ok";
}

/**
 * The credential-row ids for a device shown in the UI (its whole identity
 * group), so the registry can drop every live connection on revoke.
 */
export function deviceStoreIdsFor(id: string): string[] {
  const db = getDb();
  const row = db.prepare("SELECT identity FROM devices WHERE id = ?").get(id) as { identity: string | null } | undefined;
  if (!row) return [];
  if (!row.identity) return [id];
  const rows = db.prepare("SELECT id FROM devices WHERE identity = ?").all(row.identity) as { id: string }[];
  return rows.map((r) => r.id);
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

// --- Test seam -------------------------------------------------------------

export function resetStoreForTest() {
  try {
    closeDatabase();
  } catch {
    /* not open */
  }
  initialized = false;
  issuedKeys.clear();
}
