import { createHash } from "crypto";

// Module-private shared state and helpers used by several deviceStore
// modules. This is the one piece that must be shared, so get it right first.

export const AUTH_KEY_PREFIX = "sk_";
export const DEVICE_KEY_PREFIX = "dk_";
export const PENDING_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_AUTH_KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Omits characters that are easy to misread out loud or in a terminal font.
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";

/**
 * Device keys issued by an approval, waiting for the agent to collect them.
 * In memory only and never persisted: this is the one moment a plaintext device
 * key exists server-side, and persisting it would break the guarantee that the
 * database contains nothing usable. A restart mid-approval just expires it.
 */
export const issuedKeys: Map<string, string> = new Map();

export function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function now(): number {
  return Date.now();
}

// Machines waiting for approval are shown live on the dashboard, so anything
// that adds, approves, denies or expires one has to say so.
const pendingListeners: Set<() => void> = new Set();

export function onPendingDevicesChange(listener: () => void) {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}

export function emitPendingChange() {
  for (const listener of pendingListeners) listener();
}
