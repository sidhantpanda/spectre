const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "";

export type AgentStatus = "connecting" | "connected" | "disconnected";

export type AgentFingerprint = {
  hostname: string;
  machineId?: string;
  macAddresses: string[];
  nics: string[];
};

export type Agent = {
  id: string;
  address: string;
  status: AgentStatus;
  lastSeen: number;
  fingerprint?: AgentFingerprint;
  remoteAgentId?: string;
};

export async function fetchAgents(apiBase: string = API_BASE): Promise<Agent[]> {
  const res = await fetch(`${apiBase}/agents`);
  if (!res.ok) throw new Error("failed to fetch agents");
  return res.json();
}
