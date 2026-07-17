import express, { type NextFunction, type Request, type Response } from "express";
import {
  type AgentDependencies,
  disconnectDevice,
  listAgents,
  pushToAgent,
  refreshAllDockerInfo,
  refreshAllNetworkInfo,
  refreshAllSystemInfo,
} from "./agentRegistry";
import { authMiddleware, extractToken, isAuthEnabled, issueWsTicket, login, logout } from "./auth";
import { corsOrigins } from "./config";
import {
  approvePendingDevice,
  createAuthKey,
  createPendingDevice,
  denyPendingDevice,
  isInitialized as isDeviceStoreInitialized,
  listAuthKeys,
  listDevices,
  listPendingDevices,
  pollPendingDevice,
  revokeAuthKey,
  revokeDevice,
} from "./deviceStore";
import { clientKey } from "./utils/net";
import { rateLimit } from "./utils/rateLimit";
import { getServerVersion } from "./version";

export function createApp(
  deps: AgentDependencies = {
    listAgents,
    pushToAgent,
    refreshDockerInfo: refreshAllDockerInfo,
    refreshSystemInfo: refreshAllSystemInfo,
    refreshNetworkInfo: refreshAllNetworkInfo,
  },
) {
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  app.use((_req: Request, res: Response, next: NextFunction) => {
    // The API serves JSON only; these keep a response from ever being
    // interpreted as an active document by a browser.
    res.header("X-Content-Type-Options", "nosniff");
    res.header("Referrer-Policy", "no-referrer");
    res.header("Cache-Control", "no-store");
    next();
  });

  const allowedOrigins = corsOrigins();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    // No wildcard: this API hands out shells, and "*" would let any page on the
    // internet drive it with a token it phished. Origins must be named.
    if (origin && allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get("/version", (_req: Request, res: Response) => {
    res.json({ version: getServerVersion() });
  });

  app.get("/auth/status", (_req: Request, res: Response) => {
    res.json({ authEnabled: isAuthEnabled() });
  });

  app.post(
    "/auth/login",
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: "too many login attempts" }),
    (req: Request, res: Response) => {
      const { password } = req.body as { password?: string };
      if (typeof password !== "string" || password.length === 0) {
        return res.status(400).json({ error: "missing password" });
      }
      const result = login(password, clientKey(req));
      if (result.ok) {
        return res.json({ token: result.token });
      }
      if (result.reason === "rate_limited") {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        return res.status(429).json({ error: "too many attempts", retryAfterSeconds: result.retryAfterSeconds });
      }
      return res.status(401).json({ error: "invalid password" });
    },
  );

  // --- Agent-facing enrollment. Unauthenticated by necessity: a machine that
  // has not been approved yet has no credential to present. Both endpoints are
  // rate limited, and neither reveals anything without an admin approving.
  const enrollLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: "too many enrollment requests" });

  app.post("/devices/approval-request", enrollLimiter, (req: Request, res: Response) => {
    if (!isDeviceStoreInitialized()) {
      return res.status(503).json({ error: "device store not initialized" });
    }
    const { hostname, deviceId } = req.body as { hostname?: string; deviceId?: string };
    const pending = createPendingDevice({
      hostname: typeof hostname === "string" ? hostname.slice(0, 128) : undefined,
      deviceId: typeof deviceId === "string" ? deviceId.slice(0, 128) : undefined,
    });
    res.json(pending);
  });

  app.post("/devices/approval-poll", enrollLimiter, (req: Request, res: Response) => {
    if (!isDeviceStoreInitialized()) {
      return res.status(503).json({ error: "device store not initialized" });
    }
    const { pollToken } = req.body as { pollToken?: string };
    if (typeof pollToken !== "string" || pollToken.length === 0) {
      return res.status(400).json({ error: "missing pollToken" });
    }
    res.json(pollPendingDevice(pollToken));
  });

  app.use(authMiddleware);

  // --- Everything below requires an admin session.

  app.post("/auth/logout", (req: Request, res: Response) => {
    const token = extractToken(req);
    if (token) logout(token);
    res.json({ ok: true });
  });

  /** Trades the session for a single-use ticket to open a terminal WebSocket. */
  app.post("/auth/ws-ticket", (_req: Request, res: Response) => {
    res.json({ ticket: issueWsTicket() });
  });

  app.get("/agents", (_req: Request, res: Response) => {
    res.json(deps.listAgents());
  });

  app.post("/agents/:id/command", (req: Request, res: Response) => {
    const { data } = req.body as { data?: string };
    if (typeof data !== "string" || data.length === 0) {
      return res.status(400).json({ error: "missing data" });
    }
    try {
      deps.pushToAgent(req.params.id, { type: "keystroke", data });
      res.json({ status: "sent" });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.post("/agents/refresh-docker", (_req: Request, res: Response) => {
    deps.refreshDockerInfo?.();
    res.json({ status: "requested" });
  });

  app.post("/agents/refresh-system", (_req: Request, res: Response) => {
    deps.refreshSystemInfo?.();
    res.json({ status: "requested" });
  });

  app.post("/agents/refresh-network", (_req: Request, res: Response) => {
    deps.refreshNetworkInfo?.();
    res.json({ status: "requested" });
  });

  // --- Auth keys

  app.post("/authkeys", requireStore, (req: Request, res: Response) => {
    const { reusable, expiresInMs, description } = req.body as {
      reusable?: boolean;
      expiresInMs?: number;
      description?: string;
    };
    const { key, record } = createAuthKey({
      reusable: Boolean(reusable),
      expiresInMs: typeof expiresInMs === "number" && expiresInMs > 0 ? expiresInMs : undefined,
      description: typeof description === "string" ? description.slice(0, 200) : undefined,
    });
    // The only time the plaintext key is ever returned.
    res.json({ key, ...record });
  });

  app.get("/authkeys", requireStore, (_req: Request, res: Response) => {
    res.json(listAuthKeys());
  });

  app.delete("/authkeys/:id", requireStore, (req: Request, res: Response) => {
    if (!revokeAuthKey(req.params.id)) {
      return res.status(404).json({ error: "auth key not found" });
    }
    res.json({ ok: true });
  });

  // --- Devices

  app.get("/devices", requireStore, (_req: Request, res: Response) => {
    res.json(listDevices());
  });

  app.delete("/devices/:id", requireStore, (req: Request, res: Response) => {
    if (!revokeDevice(req.params.id)) {
      return res.status(404).json({ error: "device not found" });
    }
    // Revocation has to take effect now, not at the next reconnect.
    disconnectDevice(req.params.id);
    res.json({ ok: true });
  });

  // --- Pending approvals

  app.get("/devices/pending", requireStore, (_req: Request, res: Response) => {
    res.json(listPendingDevices());
  });

  app.post("/devices/pending/:userCode/approve", requireStore, (req: Request, res: Response) => {
    const { name } = req.body as { name?: string };
    const device = approvePendingDevice(req.params.userCode, typeof name === "string" ? name.slice(0, 128) : undefined);
    if (!device) {
      return res.status(404).json({ error: "no pending device with that code" });
    }
    res.json(device);
  });

  app.post("/devices/pending/:userCode/deny", requireStore, (req: Request, res: Response) => {
    if (!denyPendingDevice(req.params.userCode)) {
      return res.status(404).json({ error: "no pending device with that code" });
    }
    res.json({ ok: true });
  });

  return app;
}

function requireStore(_req: Request, res: Response, next: NextFunction) {
  if (!isDeviceStoreInitialized()) {
    res.status(503).json({ error: "device store not initialized" });
    return;
  }
  next();
}
