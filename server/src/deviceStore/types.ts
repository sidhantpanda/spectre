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
  /** When a browser last opened a shell here; undefined if never. */
  lastConnectedAt?: number;
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

export type PollResult =
  | { status: "pending" }
  | { status: "approved"; deviceKey: string }
  | { status: "expired" };

// --- Row types and JSON helpers --------------------------------------------

export interface DeviceRow {
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

export function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
