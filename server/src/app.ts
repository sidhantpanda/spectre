import express, { type NextFunction, type Request, type Response } from "express";
import {
  type AgentDependencies,
  connectToAgent,
  listAgents,
  pushToAgent,
  refreshAllDockerInfo,
  refreshAllNetworkInfo,
  refreshAllSystemInfo,
} from "./agentRegistry";
import { AUTH_TOKEN } from "./config";

export function createApp(
  deps: AgentDependencies = {
    listAgents,
    connectToAgent,
    pushToAgent,
    refreshDockerInfo: refreshAllDockerInfo,
    refreshSystemInfo: refreshAllSystemInfo,
    refreshNetworkInfo: refreshAllNetworkInfo,
  },
  defaultToken: string = AUTH_TOKEN,
) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.get("/agents", (_req: Request, res: Response) => {
    res.json(deps.listAgents());
  });

  app.post("/agents/connect", (req: Request, res: Response) => {
    const { address, token } = req.body as { address?: string; token?: string };
    if (!address) {
      return res.status(400).json({ error: "missing address" });
    }
    const record = deps.connectToAgent(address, token || defaultToken);
    res.json(record);
  });

  app.post("/agents/:id/command", (req: Request, res: Response) => {
    const { id } = req.params;
    const { data } = req.body as { data?: string };
    if (!data) {
      return res.status(400).json({ error: "missing data" });
    }
    try {
      deps.pushToAgent(id, { type: "keystroke", data });
      res.json({ status: "sent" });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.post("/agents/refresh-docker", (_req: Request, res: Response) => {
    if (deps.refreshDockerInfo) {
      deps.refreshDockerInfo();
    }
    res.json({ status: "requested" });
  });

  app.post("/agents/refresh-system", (_req: Request, res: Response) => {
    if (deps.refreshSystemInfo) {
      deps.refreshSystemInfo();
    }
    res.json({ status: "requested" });
  });

  app.post("/agents/refresh-network", (_req: Request, res: Response) => {
    if (deps.refreshNetworkInfo) {
      deps.refreshNetworkInfo();
    }
    res.json({ status: "requested" });
  });

  return app;
}
