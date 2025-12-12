const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "";

export type AgentStatus = "connecting" | "connected" | "disconnected";
export type AgentDirection = "inbound" | "outbound";

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
   direction: AgentDirection;
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
  const base = apiBase && apiBase.length > 0 ? apiBase : window.location.origin;
  const url = new URL("/agents/events", base);
  url.protocol = url.protocol.replace("http", "ws");
  return url.toString();
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
