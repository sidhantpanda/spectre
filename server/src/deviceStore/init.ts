import fs from "fs";
import path from "path";
import { closeDatabase, getDb, openDatabase } from "../db";
import { emitPendingChange, issuedKeys, now } from "./internal";

let initialized = false;

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
