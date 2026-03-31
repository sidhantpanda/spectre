import { randomBytes } from "crypto";
import { type NextFunction, type Request, type Response } from "express";
import { ADMIN_PASSWORD } from "./config";

interface Session {
  token: string;
  createdAt: number;
  lastUsed: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const sessions: Map<string, Session> = new Map();

function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

function pruneExpired() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.lastUsed > SESSION_TTL_MS) {
      sessions.delete(token);
    }
  }
}

export function isAuthEnabled(): boolean {
  return ADMIN_PASSWORD.length > 0;
}

export function login(password: string): string | null {
  if (!isAuthEnabled()) return null;
  if (password !== ADMIN_PASSWORD) return null;
  pruneExpired();
  const token = generateSessionToken();
  sessions.set(token, { token, createdAt: Date.now(), lastUsed: Date.now() });
  return token;
}

export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.lastUsed > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  session.lastUsed = Date.now();
  return true;
}

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

export function extractTokenFromUrl(url: string, host: string): string | null {
  try {
    const { searchParams } = new URL(url, `http://${host}`);
    return searchParams.get("authToken");
  } catch {
    return null;
  }
}

const PUBLIC_PATHS = new Set(["/auth/login", "/auth/status", "/version"]);

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isAuthEnabled()) {
    next();
    return;
  }

  if (req.method === "OPTIONS") {
    next();
    return;
  }

  if (PUBLIC_PATHS.has(req.path)) {
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
