import { Router, type Request, type Response } from "express";
import { type AgentDependencies } from "../agentRegistry";
import { extractToken, issueWsTicket, logout } from "../auth";
import { deleteDevice } from "../deviceStore";
import { requireStore } from "./requireStore";

/**
 * Everything mounted after authMiddleware that isn't auth-key or device
 * management: the session teardown routes, and /agents*.
 */
export function agentRoutes(deps: AgentDependencies): Router {
  const router = Router();

  router.post("/auth/logout", (req: Request, res: Response) => {
    const token = extractToken(req);
    if (token) logout(token);
    res.json({ ok: true });
  });

  /** Trades the session for a single-use ticket to open a terminal WebSocket. */
  router.post("/auth/ws-ticket", (_req: Request, res: Response) => {
    res.json({ ticket: issueWsTicket() });
  });

  router.get("/agents", (_req: Request, res: Response) => {
    res.json(deps.listAgents());
  });

  router.post("/agents/:id/command", (req: Request, res: Response) => {
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

  router.post("/agents/refresh-docker", (_req: Request, res: Response) => {
    deps.refreshDockerInfo?.();
    res.json({ status: "requested" });
  });

  router.post("/agents/refresh-system", (_req: Request, res: Response) => {
    deps.refreshSystemInfo?.();
    res.json({ status: "requested" });
  });

  router.post("/agents/refresh-network", (_req: Request, res: Response) => {
    deps.refreshNetworkInfo?.();
    res.json({ status: "requested" });
  });

  // Removes a disconnected device from the dashboard for good. A connected
  // device can't be removed this way — revoke it instead, so its live socket is
  // dropped rather than left dangling.
  router.delete("/agents/:id", requireStore, (req: Request, res: Response) => {
    const result = deleteDevice(req.params.id);
    if (result === "not_found") {
      return res.status(404).json({ error: "device not found" });
    }
    if (result === "connected") {
      return res.status(409).json({ error: "device is connected" });
    }
    res.json({ ok: true });
  });

  return router;
}
