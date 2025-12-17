import { buildWsUrl, getApiBase } from "../lib/api";

const API_BASE = getApiBase();

export type AgentStatus = "connecting" | "connected" | "disconnected";
export type AgentDirection = "inbound" | "outbound";

export type AgentFingerprint = {
  hostname: string;
  machineId?: string;
  macAddresses: string[];
  nics: string[];
};

export type DockerContainer = {
  name: string;
  ports: string[];
};

export type Agent = {
  id: string;
  connectionId: string;
  address: string;
  status: AgentStatus;
  lastSeen: number;
  deviceId?: string;
  fingerprint?: AgentFingerprint;
  remoteAgentId?: string;
  direction: AgentDirection;
  docker?: DockerContainer[];
  dockerError?: string;
};

export async function fetchAgents(apiBase: string = API_BASE): Promise<Agent[]> {
  const res = await fetch(`${apiBase}/agents`);
  if (!res.ok) throw new Error("failed to fetch agents");
  return res.json();
}

export type AgentEvent =
  | { type: "agents"; agents: Agent[] }
  | { type: "agent"; agent: Agent };

function buildAgentEventsUrl(apiBase: string = API_BASE) {
  return buildWsUrl("/agents/events", apiBase);
}

export function subscribeToAgentEvents(
  onAgents: (agents: Agent[]) => void,
  onAgentUpdate: (agent: Agent) => void,
  apiBase: string = API_BASE,
) {
  const socket = new WebSocket(buildAgentEventsUrl(apiBase));

  socket.onmessage = (evt) => {
    try {
      const payload = JSON.parse(evt.data) as AgentEvent;
      if (payload.type === "agents") {
        onAgents(payload.agents);
      } else if (payload.type === "agent") {
        onAgentUpdate(payload.agent);
      }
    } catch {
      // ignore malformed events
    }
  };

  return socket;
}
