import { randomBytes, randomInt } from "crypto";
import { v4 as uuid } from "uuid";
import { getDb } from "../db";
import { createDevice } from "./credentials";
import { prune } from "./init";
import { emitPendingChange, hash, issuedKeys, now, PENDING_TTL_MS, USER_CODE_ALPHABET } from "./internal";
import { getPublicDevice } from "./reads";
import { type PollResult, type PublicDevice, type PublicPendingDevice } from "./types";

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
