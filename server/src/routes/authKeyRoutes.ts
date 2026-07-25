import { Router, type Request, type Response } from "express";
import { createAuthKey, listAuthKeys, revokeAuthKey } from "../deviceStore";
import { requireStore } from "./requireStore";

// --- Auth keys
export function authKeyRoutes(): Router {
  const router = Router();

  router.post("/authkeys", requireStore, (req: Request, res: Response) => {
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

  router.get("/authkeys", requireStore, (_req: Request, res: Response) => {
    res.json(listAuthKeys());
  });

  router.delete("/authkeys/:id", requireStore, (req: Request, res: Response) => {
    if (!revokeAuthKey(req.params.id)) {
      return res.status(404).json({ error: "auth key not found" });
    }
    res.json({ ok: true });
  });

  return router;
}
