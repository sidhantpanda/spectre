import { createHash, randomBytes, randomInt } from "crypto";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

/**
 * Credentials are stored as SHA-256 hashes. Reading store.json (or a backup of
 * it) must not be enough to impersonate a device or enroll a new one. The
 * plaintext of a secret is returned exactly once, at the moment it is created.
 *
 * These are high-entropy random tokens, not passwords, so a fast hash is the
 * right choice: there is nothing to brute-force and no need for a KDF.
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

/** A device as exposed over the API: never includes key material. */
export interface PublicDevice {
  id: string;
  deviceId?: string;
  name?: string;
  enrolledAt: number;
  lastSeen: number;
  revoked: boolean;
}

export interface AuthKeyRecord {
  id: string;
  keyHash: string;
  /** Leading characters of the plaintext, for identifying a key in the UI. */
  hint: string;
  description?: string;
  reusable: boolean;
  createdAt: number;
  expiresAt: number;
  uses: number;
  revokedAt?: number;
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

/** A machine waiting for an admin to approve it (the `spectre-agent up` flow). */
export interface PendingDeviceRecord {
  id: string;
  userCode: string;
  pollTokenHash: string;
  hostname?: string;
  deviceId?: string;
  createdAt: number;
  expiresAt: number;
  approvedAt?: number;
  claimed: boolean;
}

export interface PublicPendingDevice {
  id: string;
  userCode: string;
  hostname?: string;
  createdAt: number;
  expiresAt: number;
}

interface StoreData {
  devices: DeviceRecord[];
  authKeys: AuthKeyRecord[];
  pending: PendingDeviceRecord[];
}

const AUTH_KEY_PREFIX = "sk_";
const DEVICE_KEY_PREFIX = "dk_";
const PENDING_TTL_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Omits characters that are easy to misread out loud or in a terminal font.
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";

let storePath = "";
let data: StoreData = { devices: [], authKeys: [], pending: [] };
let initialized = false;

/**
 * Device keys issued by an approval, waiting for the agent to collect them.
 *
 * Deliberately in memory only and never persisted: this is the one moment a
 * plaintext device key exists server-side, and writing it to disk — even
 * briefly — would break the guarantee that store.json contains nothing usable.
 * A server restart mid-approval simply expires the request, and the operator
 * approves again.
 */
const issuedKeys: Map<string, string> = new Map();

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function persist() {
  if (!storePath) return;
  const tmpPath = `${storePath}.tmp`;
  // The store holds credential hashes and pending plaintext keys; keep it
  // unreadable to other users on the host.
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, storePath);
}

export function initDeviceStore(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  storePath = path.join(dataDir, "store.json");
  // Always start from a clean slate: initialising against an empty directory
  // must not inherit state from a previous store.
  data = { devices: [], authKeys: [], pending: [] };

  if (fs.existsSync(storePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Partial<StoreData>;
      data = {
        devices: parsed.devices ?? [],
        authKeys: parsed.authKeys ?? [],
        pending: parsed.pending ?? [],
      };
    } catch {
      data = { devices: [], authKeys: [], pending: [] };
    }
    try {
      fs.chmodSync(storePath, 0o600);
    } catch {
      /* best effort on platforms without POSIX modes */
    }
  }
  initialized = true;
  prune();
}

export function isInitialized() {
  return initialized;
}

/** Drops expired pending enrollments and expired, unused auth keys. */
export function prune() {
  const now = Date.now();
  const before = data.pending.length + data.authKeys.length;

  const expired = data.pending.filter((p) => now >= p.expiresAt || p.claimed);
  // Never leave an unclaimed device key sitting in memory after its request dies.
  for (const record of expired) issuedKeys.delete(record.id);

  data.pending = data.pending.filter((p) => now < p.expiresAt && !p.claimed);
  data.authKeys = data.authKeys.filter((k) => now < k.expiresAt || k.uses > 0);
  if (data.pending.length + data.authKeys.length !== before) persist();
}

// --- Auth keys (Tailscale-style pre-authentication) -------------------------

export function createAuthKey(options: {
  reusable?: boolean;
  expiresInMs?: number;
  description?: string;
} = {}): { key: string; record: PublicAuthKey } {
  const now = Date.now();
  const key = AUTH_KEY_PREFIX + randomBytes(24).toString("hex");
  const record: AuthKeyRecord = {
    id: uuid(),
    keyHash: hash(key),
    hint: key.slice(0, AUTH_KEY_PREFIX.length + 6),
    description: options.description,
    reusable: options.reusable ?? false,
    createdAt: now,
    expiresAt: now + (options.expiresInMs ?? DEFAULT_AUTH_KEY_TTL_MS),
    uses: 0,
  };
  data.authKeys.push(record);
  persist();
  return { key, record: toPublicAuthKey(record) };
}

/**
 * Redeems an auth key and enrols a device. Single-use keys are burned here, so
 * a leaked key cannot enrol a second machine.
 */
export function redeemAuthKey(key: string, deviceId?: string): { device: DeviceRecord; deviceKey: string } | null {
  const keyHash = hash(key);
  const record = data.authKeys.find((k) => k.keyHash === keyHash);
  if (!record) return null;
  if (record.revokedAt) return null;
  if (Date.now() > record.expiresAt) return null;
  if (!record.reusable && record.uses > 0) return null;

  record.uses += 1;
  const created = createDevice(deviceId);
  persist();
  return created;
}

export function listAuthKeys(): PublicAuthKey[] {
  return data.authKeys.map(toPublicAuthKey);
}

export function revokeAuthKey(id: string): boolean {
  const record = data.authKeys.find((k) => k.id === id);
  if (!record || record.revokedAt) return false;
  record.revokedAt = Date.now();
  persist();
  return true;
}

function toPublicAuthKey(record: AuthKeyRecord): PublicAuthKey {
  return {
    id: record.id,
    hint: record.hint,
    description: record.description,
    reusable: record.reusable,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    uses: record.uses,
    revoked: Boolean(record.revokedAt),
  };
}

// --- Interactive approval (the bare `spectre-agent up` flow) ----------------

function generateUserCode(): string {
  const pick = () =>
    Array.from({ length: 4 }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

/**
 * Starts an approval request for a machine that has no auth key. Returns a
 * short code the human reads, plus a poll token only this agent knows.
 */
export function createPendingDevice(info: { hostname?: string; deviceId?: string }): {
  userCode: string;
  pollToken: string;
  expiresAt: number;
} {
  prune();
  const now = Date.now();
  const pollToken = randomBytes(32).toString("hex");

  let userCode = generateUserCode();
  while (data.pending.some((p) => p.userCode === userCode)) {
    userCode = generateUserCode();
  }

  const record: PendingDeviceRecord = {
    id: uuid(),
    userCode,
    pollTokenHash: hash(pollToken),
    hostname: info.hostname,
    deviceId: info.deviceId,
    createdAt: now,
    expiresAt: now + PENDING_TTL_MS,
    claimed: false,
  };
  data.pending.push(record);
  persist();
  return { userCode, pollToken, expiresAt: record.expiresAt };
}

export type PollResult =
  | { status: "pending" }
  | { status: "approved"; deviceKey: string }
  | { status: "expired" };

/**
 * Called by the agent while it waits for approval. Once approved, the device
 * key is handed over exactly once and the pending record is retired.
 */
export function pollPendingDevice(pollToken: string): PollResult {
  const tokenHash = hash(pollToken);
  const record = data.pending.find((p) => p.pollTokenHash === tokenHash);
  if (!record) return { status: "expired" };
  if (Date.now() > record.expiresAt) return { status: "expired" };
  if (!record.approvedAt) return { status: "pending" };

  const deviceKey = issuedKeys.get(record.id);
  if (!deviceKey) return { status: "expired" };

  issuedKeys.delete(record.id);
  record.claimed = true;
  data.pending = data.pending.filter((p) => p.id !== record.id);
  persist();
  return { status: "approved", deviceKey };
}

export function listPendingDevices(): PublicPendingDevice[] {
  prune();
  return data.pending
    .filter((p) => !p.approvedAt)
    .map((p) => ({
      id: p.id,
      userCode: p.userCode,
      hostname: p.hostname,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
    }));
}

/** Approves a waiting machine. The agent picks the key up on its next poll. */
export function approvePendingDevice(userCode: string, name?: string): PublicDevice | null {
  prune();
  const normalized = userCode.trim().toUpperCase();
  const record = data.pending.find((p) => p.userCode === normalized && !p.approvedAt);
  if (!record) return null;
  if (Date.now() > record.expiresAt) return null;

  const { device, deviceKey } = createDevice(record.deviceId);
  if (name) {
    device.name = name;
  } else if (record.hostname) {
    device.name = record.hostname;
  }
  record.approvedAt = Date.now();
  issuedKeys.set(record.id, deviceKey);
  persist();
  return toPublicDevice(device);
}

export function denyPendingDevice(userCode: string): boolean {
  const normalized = userCode.trim().toUpperCase();
  const denied = data.pending.filter((p) => p.userCode === normalized);
  if (denied.length === 0) return false;
  for (const record of denied) issuedKeys.delete(record.id);
  data.pending = data.pending.filter((p) => p.userCode !== normalized);
  persist();
  return true;
}

// --- Devices ---------------------------------------------------------------

function createDevice(deviceId?: string): { device: DeviceRecord; deviceKey: string } {
  const deviceKey = DEVICE_KEY_PREFIX + randomBytes(32).toString("hex");
  const device: DeviceRecord = {
    id: uuid(),
    keyHash: hash(deviceKey),
    deviceId,
    enrolledAt: Date.now(),
    lastSeen: Date.now(),
  };
  data.devices.push(device);
  persist();
  return { device, deviceKey };
}

/** Resolves a presented device key. Revoked devices never authenticate. */
export function findDeviceByKey(key: string): DeviceRecord | null {
  const keyHash = hash(key);
  const device = data.devices.find((d) => d.keyHash === keyHash);
  if (!device || device.revokedAt) return null;
  return device;
}

export function touchDevice(key: string, updates: Partial<Pick<DeviceRecord, "deviceId" | "name" | "lastSeen">>): void {
  const keyHash = hash(key);
  const device = data.devices.find((d) => d.keyHash === keyHash);
  if (device) {
    Object.assign(device, updates);
    persist();
  }
}

export function listDevices(): PublicDevice[] {
  return data.devices.map(toPublicDevice);
}

/** Revokes a device. Its key stops working on the next connection attempt. */
export function revokeDevice(id: string): boolean {
  const device = data.devices.find((d) => d.id === id);
  if (!device || device.revokedAt) return false;
  device.revokedAt = Date.now();
  persist();
  return true;
}

function toPublicDevice(device: DeviceRecord): PublicDevice {
  return {
    id: device.id,
    deviceId: device.deviceId,
    name: device.name,
    enrolledAt: device.enrolledAt,
    lastSeen: device.lastSeen,
    revoked: Boolean(device.revokedAt),
  };
}

/** Test seam: resets the in-memory store without touching disk. */
export function resetStoreForTest() {
  data = { devices: [], authKeys: [], pending: [] };
  storePath = "";
  initialized = true;
}
