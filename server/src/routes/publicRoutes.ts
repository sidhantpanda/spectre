import { Router, type Request, type Response } from "express";
import { isAuthEnabled, login } from "../auth";
import { PORT, PUBLIC_HOST } from "../config";
import { createPendingDevice, isInitialized as isDeviceStoreInitialized, pollPendingDevice } from "../deviceStore";
import { clientKey, primaryHostAddress } from "../utils/net";
import { rateLimit } from "../utils/rateLimit";
import { getServerVersion } from "../version";

/** Everything mounted before authMiddleware: no session is required. */
export function publicRoutes(): Router {
  const router = Router();

  router.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  router.get("/version", (_req: Request, res: Response) => {
    res.json({ version: getServerVersion() });
  });

  router.get("/auth/status", (_req: Request, res: Response) => {
    res.json({ authEnabled: isAuthEnabled() });
  });

  // Where an agent should dial to reach this server. Used to build the
  // enrollment command in the UI so it shows a reachable address, not the
  // browser's own URL. Behind a TLS proxy, set SPECTRE_PUBLIC_HOST; otherwise
  // the server advertises its detected LAN address and API port.
  router.get("/connect-info", (_req: Request, res: Response) => {
    const host = PUBLIC_HOST || `ws://${primaryHostAddress()}:${PORT}`;
    res.json({ host });
  });

  router.post(
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

  router.post("/devices/approval-request", enrollLimiter, (req: Request, res: Response) => {
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

  router.post("/devices/approval-poll", enrollLimiter, (req: Request, res: Response) => {
    if (!isDeviceStoreInitialized()) {
      return res.status(503).json({ error: "device store not initialized" });
    }
    const { pollToken } = req.body as { pollToken?: string };
    if (typeof pollToken !== "string" || pollToken.length === 0) {
      return res.status(400).json({ error: "missing pollToken" });
    }
    res.json(pollPendingDevice(pollToken));
  });

  return router;
}
