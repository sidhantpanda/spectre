import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { type NextFunction, type Request, type Response } from "express";
import { ADMIN_PASSWORD, DEV_NO_AUTH } from "./config";

interface Session {
  token: string;
  createdAt: number;
  lastUsed: number;
}

// Sessions expire on idle, but also absolutely: a stolen token stays useful for
// at most SESSION_MAX_AGE_MS no matter how much it is exercised.
const SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// WebSocket tickets exist because browsers cannot set headers on a WebSocket
// handshake. Rather than putting a long-lived session token in a URL (where it
// lands in access logs and Referer headers), the client trades its session for
// a single-use ticket that is worthless seconds later.
const TICKET_TTL_MS = 30 * 1000;

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

const sessions: Map<string, Session> = new Map();
const tickets: Map<string, { expiresAt: number }> = new Map();
const loginAttempts: Map<string, { count: number; first: number; lockedUntil: number }> = new Map();

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Compares two secrets without leaking their contents or their lengths.
 * Digesting first keeps both operands a fixed 32 bytes, so timingSafeEqual
 * never sees a length mismatch (which it would throw on, leaking length).
 */
function secretsMatch(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

function pruneExpired() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.lastUsed > SESSION_IDLE_TTL_MS || now - session.createdAt > SESSION_MAX_AGE_MS) {
      sessions.delete(token);
    }
  }
  for (const [ticket, record] of tickets) {
    if (now > record.expiresAt) tickets.delete(ticket);
  }
}

export function isAuthEnabled(): boolean {
  return !DEV_NO_AUTH;
}

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * Verifies the admin password and issues a session token. Repeated failures
 * from the same client are locked out to keep the single shared password from
 * being brute-forced.
 */
export function login(password: string, clientKey: string): LoginResult {
  const now = Date.now();
  const record = loginAttempts.get(clientKey);

  if (record && now < record.lockedUntil) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000) };
  }

  if (!isAuthEnabled() || !secretsMatch(password, ADMIN_PASSWORD)) {
    registerFailedLogin(clientKey, now);
    return { ok: false, reason: "invalid" };
  }

  loginAttempts.delete(clientKey);
  pruneExpired();
  const token = generateToken();
  sessions.set(token, { token, createdAt: now, lastUsed: now });
  return { ok: true, token };
}

function registerFailedLogin(clientKey: string, now: number) {
  const record = loginAttempts.get(clientKey);
  if (!record || now - record.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(clientKey, { count: 1, first: now, lockedUntil: 0 });
    return;
  }
  record.count += 1;
  if (record.count >= LOGIN_MAX_ATTEMPTS) {
    record.lockedUntil = now + LOGIN_LOCKOUT_MS;
    record.count = 0;
    record.first = now;
  }
}

export function logout(token: string) {
  sessions.delete(token);
}

export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  const now = Date.now();
  if (now - session.lastUsed > SESSION_IDLE_TTL_MS || now - session.createdAt > SESSION_MAX_AGE_MS) {
    sessions.delete(token);
    return false;
  }
  session.lastUsed = now;
  return true;
}

/** Issues a single-use, short-lived ticket for authenticating a WebSocket upgrade. */
export function issueWsTicket(): string {
  pruneExpired();
  const ticket = generateToken();
  tickets.set(ticket, { expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

/** Redeems a WebSocket ticket. Each ticket is valid exactly once. */
export function redeemWsTicket(ticket: string | null): boolean {
  if (!ticket) return false;
  const record = tickets.get(ticket);
  if (!record) return false;
  tickets.delete(ticket);
  return Date.now() <= record.expiresAt;
}

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

export function extractTicketFromUrl(url: string, host: string): string | null {
  try {
    const { searchParams } = new URL(url, `http://${host}`);
    return searchParams.get("ticket");
  } catch {
    return null;
  }
}

const PUBLIC_PATHS = new Set(["/auth/login", "/auth/status", "/version", "/healthz"]);

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isAuthEnabled()) {
    next();
    return;
  }

  if (req.method === "OPTIONS" || PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  const token = extractToken(req);
  if (!token || !validateSession(token)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

/** Test seam: clears all in-memory auth state. */
export function resetAuthState() {
  sessions.clear();
  tickets.clear();
  loginAttempts.clear();
}
