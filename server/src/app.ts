import express, { Router, type NextFunction, type Request, type Response } from "express";
import {
  type AgentDependencies,
  listAgents,
  pushToAgent,
  refreshAllDockerInfo,
  refreshAllNetworkInfo,
  refreshAllSystemInfo,
} from "./agentRegistry";
import { authMiddleware } from "./auth";
import { API_PREFIX, corsOrigins } from "./config";
import { agentRoutes } from "./routes/agentRoutes";
import { authKeyRoutes } from "./routes/authKeyRoutes";
import { deviceRoutes } from "./routes/deviceRoutes";
import { publicRoutes } from "./routes/publicRoutes";

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

  // Mounted as one subtree so route paths stay relative to API_PREFIX: the
  // public-path allowlist in authMiddleware keeps matching "/auth/login" and
  // friends without having to know the prefix.
  const api = Router();

  api.use(publicRoutes());

  api.use(authMiddleware);

  // --- Everything below requires an admin session.

  api.use(agentRoutes(deps));
  api.use(authKeyRoutes());
  api.use(deviceRoutes());

  app.use(API_PREFIX, api);

  return app;
}
