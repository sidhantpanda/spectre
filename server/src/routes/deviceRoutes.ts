import { Router, type Request, type Response } from "express";
import { disconnectDevice } from "../agentRegistry";
import {
  approvePendingDevice,
  denyPendingDevice,
  deviceStoreIdsFor,
  listConnections,
  listDevices,
  listPendingDevices,
  revokeDevice,
} from "../deviceStore";
import { requireStore } from "./requireStore";

export function deviceRoutes(): Router {
  const router = Router();

  // --- Devices

  router.get("/devices", requireStore, (_req: Request, res: Response) => {
    res.json(listDevices());
  });

  router.get("/devices/:id/connections", requireStore, (req: Request, res: Response) => {
    res.json(listConnections(req.params.id));
  });

  router.delete("/devices/:id", requireStore, (req: Request, res: Response) => {
    // Capture the credential rows before revoking, so we can drop every live
    // connection for this physical device (it may hold more than one key).
    const storeIds = deviceStoreIdsFor(req.params.id);
    if (!revokeDevice(req.params.id)) {
      return res.status(404).json({ error: "device not found" });
    }
    // Revocation has to take effect now, not at the next reconnect.
    for (const storeId of storeIds) disconnectDevice(storeId);
    res.json({ ok: true });
  });

  // --- Pending approvals

  router.get("/devices/pending", requireStore, (_req: Request, res: Response) => {
    res.json(listPendingDevices());
  });

  router.post("/devices/pending/:userCode/approve", requireStore, (req: Request, res: Response) => {
    const { name } = req.body as { name?: string };
    const device = approvePendingDevice(req.params.userCode, typeof name === "string" ? name.slice(0, 128) : undefined);
    if (!device) {
      return res.status(404).json({ error: "no pending device with that code" });
    }
    res.json(device);
  });

  router.post("/devices/pending/:userCode/deny", requireStore, (req: Request, res: Response) => {
    if (!denyPendingDevice(req.params.userCode)) {
      return res.status(404).json({ error: "no pending device with that code" });
    }
    res.json({ ok: true });
  });

  return router;
}
