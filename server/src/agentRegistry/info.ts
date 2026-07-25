import { connections, pushToAgent } from "./connections";

function requestInfo(agentId: string, type: "dockerInfo" | "systemInfo" | "networkInfo") {
  try {
    pushToAgent(agentId, { type });
  } catch (err) {
    console.warn(`[${type}] unable to request from ${agentId}: ${(err as Error).message}`);
  }
}

export const requestDockerInfo = (agentId: string) => requestInfo(agentId, "dockerInfo");
export const requestSystemInfo = (agentId: string) => requestInfo(agentId, "systemInfo");
export const requestNetworkInfo = (agentId: string) => requestInfo(agentId, "networkInfo");

function refreshAll(type: "dockerInfo" | "systemInfo" | "networkInfo") {
  for (const id of connections.keys()) requestInfo(id, type);
}

export const refreshAllDockerInfo = () => refreshAll("dockerInfo");
export const refreshAllSystemInfo = () => refreshAll("systemInfo");
export const refreshAllNetworkInfo = () => refreshAll("networkInfo");
