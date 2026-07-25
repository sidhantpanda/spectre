import { randomBytes } from "crypto";
import { v4 as uuid } from "uuid";
import { getDb } from "../db";
import { DEVICE_KEY_PREFIX, hash, now } from "./internal";
import { type DeviceRecord, type DeviceRow } from "./types";

// --- Devices: credentials --------------------------------------------------

export function createDevice(deviceId?: string): { device: DeviceRecord; deviceKey: string } {
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
