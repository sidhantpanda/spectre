import { buildWsUrl, getApiBase } from "../lib/api";
import { authFetch } from "../lib/auth";
import type { PendingDevice } from "./enrollment";

const API_BASE = getApiBase();

/**
 * "pending" is not a state the server reports for a device — it belongs to a
 * machine that has asked to be added and has no credential yet. The dashboard
 * lists those alongside real devices, so the dot and the label need it too.
 */
export type AgentStatus = "pending" | "connecting" | "connected" | "disconnected";

export type AgentFingerprint = {
  hostname: string;
  machineId?: string;
  macAddresses: string[];
  nics: string[];
};

export type DockerContainer = {
  name: string;
  ports?: string[];
};

export type SystemInfo = {
  os: string;
  version: string;
  cpu: string;
  arch: string;
  cores: number;
  memoryBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  tmuxAvailable?: boolean;
};

export type NetworkInfo = {
  ipv4: string[];
  ipv6: string[];
};

export type Agent = {
  id: string;
  connectionId: string;
  address: string;
  status: AgentStatus;
  lastSeen: number;
  deviceId?: string;
  /** Stable hardware identity; one physical machine keeps this across reconnects. */
  identity?: string;
  name?: string;
  enrolledAt?: number;
  firstSeen?: number;
  agentVersion?: string;
  fingerprint?: AgentFingerprint;
  docker?: DockerContainer[];
  dockerError?: string;
  systemInfo?: SystemInfo;
  systemInfoError?: string;
  networkInfo?: NetworkInfo;
  networkInfoError?: string;
};

export async function fetchAgents(apiBase: string = API_BASE): Promise<Agent[]> {
  const res = await authFetch(`${apiBase}/agents`);
  if (!res.ok) throw new Error("failed to fetch agents");
  return res.json();
}

export type AgentEvent =
  | { type: "agents"; agents: Agent[] }
  | { type: "agent"; agent: Agent }
  | { type: "pending"; pending: PendingDevice[] };

export type AgentEventHandlers = {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  /** Machines waiting for approval, pushed whenever the set changes. */
  onPending?: (pending: PendingDevice[]) => void;
};

export type AgentEventSubscription = { close: () => void };

/**
 * Subscribes to agent events.
 *
 * Opening the socket first requires a round trip to mint a WebSocket ticket, so
 * the socket does not exist synchronously. This returns a handle that is safe to
 * close before or after the socket opens, and takes lifecycle callbacks rather
 * than exposing the socket itself.
 */
export function subscribeToAgentEvents(
  onAgents: (agents: Agent[]) => void,
  onAgentUpdate: (agent: Agent) => void,
  apiBase: string = API_BASE,
  handlers: AgentEventHandlers = {},
): AgentEventSubscription {
  let socket: WebSocket | null = null;
  let closed = false;

  void buildWsUrl("/agents/events", apiBase)
    .then((url) => {
      if (closed) return;
      socket = new WebSocket(url);
      socket.onopen = () => handlers.onOpen?.();
      socket.onclose = () => {
        if (!closed) handlers.onClose?.();
      };
      socket.onerror = () => {
        if (!closed) handlers.onError?.();
      };
      socket.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data) as AgentEvent;
          if (payload.type === "agents") {
            onAgents(payload.agents);
          } else if (payload.type === "agent") {
            onAgentUpdate(payload.agent);
          } else if (payload.type === "pending") {
            handlers.onPending?.(payload.pending ?? []);
          }
        } catch {
          // ignore malformed events
        }
      };
    })
    .catch(() => {
      if (!closed) handlers.onError?.();
    });

  return {
    close: () => {
      closed = true;
      if (socket) {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
        socket = null;
      }
    },
  };
}

/** Permanently removes a disconnected device from the dashboard. */
export async function removeAgent(id: string, apiBase: string = API_BASE): Promise<void> {
  const res = await authFetch(`${apiBase}/agents/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "failed to remove device");
  }
}

export async function refreshDockerInfo(apiBase: string = API_BASE): Promise<void> {
  try {
    await authFetch(`${apiBase}/agents/refresh-docker`, { method: "POST" });
  } catch {
    // ignore fire-and-forget errors
  }
}

export async function refreshSystemInfo(apiBase: string = API_BASE): Promise<void> {
  try {
    await authFetch(`${apiBase}/agents/refresh-system`, { method: "POST" });
  } catch {
    // ignore fire-and-forget errors
  }
}

export async function refreshNetworkInfo(apiBase: string = API_BASE): Promise<void> {
  try {
    await authFetch(`${apiBase}/agents/refresh-network`, { method: "POST" });
  } catch {
    // ignore fire-and-forget errors
  }
}
