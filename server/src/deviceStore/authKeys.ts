import { randomBytes } from "crypto";
import { v4 as uuid } from "uuid";
import { getDb } from "../db";
import { createDevice } from "./credentials";
import { AUTH_KEY_PREFIX, DEFAULT_AUTH_KEY_TTL_MS, hash, now } from "./internal";
import { type DeviceRecord, type PublicAuthKey } from "./types";

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
