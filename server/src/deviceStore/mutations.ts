import { getDb } from "../db";
import { now } from "./internal";

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
