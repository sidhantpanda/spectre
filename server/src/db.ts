import fs from "fs";
import { createRequire } from "module";
import path from "path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Load node:sqlite through a runtime require rather than a static import.
// It's a genuine Node builtin, but because it's still experimental it isn't in
// module.builtinModules, so bundlers (Vite/Vitest) try and fail to resolve a
// static `node:sqlite` import. A runtime require sidesteps that entirely.
const nodeRequire = createRequire(__filename);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

/**
 * The server's persistent store: enrolled devices, their live/last-known
 * connection state, auth keys, pending approvals, and a connection history.
 *
 * SQLite (via Node's built-in node:sqlite) replaces the earlier JSON file so
 * device state survives restarts and reconnections update a single row rather
 * than accumulating duplicates.
 */

// node:sqlite is still flagged experimental and prints a warning on first use.
// It's a deliberate dependency, so silence just that one message.
const originalEmit = process.emit.bind(process);
process.emit = function (name: string, data?: unknown, ...rest: unknown[]): boolean {
  if (
    name === "warning" &&
    data &&
    typeof data === "object" &&
    (data as { name?: string }).name === "ExperimentalWarning" &&
    /SQLite/i.test((data as { message?: string }).message ?? "")
  ) {
    return false;
  }
  return (originalEmit as (name: string, ...args: unknown[]) => boolean)(name, data, ...rest);
} as typeof process.emit;

let db: DatabaseSyncType | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS auth_keys (
  id           TEXT PRIMARY KEY,
  key_hash     TEXT NOT NULL UNIQUE,
  hint         TEXT NOT NULL,
  description  TEXT,
  reusable     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  uses         INTEGER NOT NULL DEFAULT 0,
  revoked_at   INTEGER
);

CREATE TABLE IF NOT EXISTS devices (
  id               TEXT PRIMARY KEY,
  key_hash         TEXT NOT NULL UNIQUE,
  identity         TEXT,
  agent_device_id  TEXT,
  machine_id       TEXT,
  primary_mac      TEXT,
  mac_addresses    TEXT,
  hostname         TEXT,
  name             TEXT,
  fingerprint      TEXT,
  agent_version    TEXT,
  system_info      TEXT,
  network_info     TEXT,
  docker           TEXT,
  status           TEXT NOT NULL DEFAULT 'disconnected',
  last_address     TEXT,
  enrolled_at      INTEGER NOT NULL,
  first_seen       INTEGER,
  last_seen        INTEGER NOT NULL,
  revoked_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_identity ON devices(identity);

CREATE TABLE IF NOT EXISTS pending_devices (
  id               TEXT PRIMARY KEY,
  user_code        TEXT NOT NULL UNIQUE,
  poll_token_hash  TEXT NOT NULL,
  hostname         TEXT,
  device_id        TEXT,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  approved_at      INTEGER,
  claimed          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS connections (
  id               TEXT PRIMARY KEY,
  device_id        TEXT NOT NULL,
  identity         TEXT,
  address          TEXT,
  connected_at     INTEGER NOT NULL,
  disconnected_at  INTEGER,
  close_reason     TEXT
);
CREATE INDEX IF NOT EXISTS idx_connections_device ON connections(device_id, connected_at);
`;

export function openDatabase(dataDir: string): DatabaseSyncType {
  // Close any previous handle so re-initialising (mainly in tests) doesn't leak.
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    db = null;
  }

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dbPath = path.join(dataDir, "spectre.db");

  db = new DatabaseSync(dbPath);
  // WAL keeps reads and writes from blocking each other; foreign-key-free but
  // fine for this size. Both are safe to run on every open.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);

  // The DB may hold device key hashes and pending state; keep it owner-only.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.chmodSync(dbPath + suffix, 0o600);
    } catch {
      /* file may not exist yet, or platform lacks POSIX modes */
    }
  }

  return db;
}

export function getDb(): DatabaseSyncType {
  if (!db) throw new Error("database not initialized");
  return db;
}

export function closeDatabase() {
  db?.close();
  db = null;
}
