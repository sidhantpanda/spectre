import { v4 as uuid } from "uuid";
import { getDb } from "../db";
import { now } from "./internal";

/**
 * When a browser last opened a shell on a machine.
 *
 * Deliberately distinct from the `connections` table and from `lastSeen`:
 * those track the agent's own socket, which is up whenever the machine is
 * powered on and reachable. This records the machine actually being *used* —
 * a tmux session attached or a new one created from the UI.
 */

/** Which action put a browser into a session. */
export type SessionAccessKind = "create" | "attach";

/**
 * Stamps an access. Recorded against the credential row and, when the machine
 * has one, its stable hardware identity — so re-enrolling with a new key keeps
 * the history rather than resetting it.
 */
export function recordSessionAccess(
  deviceStoreId: string,
  options: { identity?: string | null; sessionId?: string | null; kind: SessionAccessKind },
): void {
  getDb()
    .prepare(
      "INSERT INTO access_history (id, device_id, identity, session_id, kind, accessed_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(uuid(), deviceStoreId, options.identity || null, options.sessionId || null, options.kind, now());
}

/**
 * The newest access for one machine, or undefined if it has never been opened.
 *
 * Matches on identity when there is one so every credential row for the same
 * physical machine shares an answer.
 */
export function lastConnectedAtFor(deviceStoreId: string, identity?: string | null): number | undefined {
  const row = identity
    ? (getDb()
        .prepare("SELECT MAX(accessed_at) AS ts FROM access_history WHERE identity = ?")
        .get(identity) as { ts: number | null } | undefined)
    : (getDb()
        .prepare("SELECT MAX(accessed_at) AS ts FROM access_history WHERE device_id = ?")
        .get(deviceStoreId) as { ts: number | null } | undefined);
  return row?.ts ?? undefined;
}

/**
 * Every machine's newest access in one query, for list endpoints.
 *
 * Lists would otherwise issue a lookup per row, and the dashboard reads the
 * whole device list on every agent event.
 */
export function lastConnectedIndex(): { byIdentity: Map<string, number>; byDevice: Map<string, number> } {
  const rows = getDb()
    .prepare("SELECT device_id, identity, MAX(accessed_at) AS ts FROM access_history GROUP BY device_id, identity")
    .all() as Array<{ device_id: string; identity: string | null; ts: number }>;

  const byIdentity = new Map<string, number>();
  const byDevice = new Map<string, number>();
  for (const row of rows) {
    byDevice.set(row.device_id, Math.max(byDevice.get(row.device_id) ?? 0, row.ts));
    if (row.identity) {
      byIdentity.set(row.identity, Math.max(byIdentity.get(row.identity) ?? 0, row.ts));
    }
  }
  return { byIdentity, byDevice };
}
