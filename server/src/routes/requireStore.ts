import { type NextFunction, type Request, type Response } from "express";
import { isInitialized as isDeviceStoreInitialized } from "../deviceStore";

export function requireStore(_req: Request, res: Response, next: NextFunction) {
  if (!isDeviceStoreInitialized()) {
    res.status(503).json({ error: "device store not initialized" });
    return;
  }
  next();
}
