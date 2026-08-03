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
  /**
   * When a browser last opened a shell here, from the server's access history.
   * Undefined until someone has. Unlike lastSeen it does not move while the
   * machine merely sits online.
   */
  lastConnectedAt?: number;
  deviceId?: string;
  /** Stable hardware identity; one physical machine keeps this across reconnects. */
  identity?: string;
  name?: string;
  enrolledAt?: number;
  firstSeen?: number;
  agentVersion?: string;
  /** Newest published agent release, when the server knows it. */
  latestAgentVersion?: string;
  /** True when this machine is running something other than latestAgentVersion. */
  updateAvailable?: boolean;
  fingerprint?: AgentFingerprint;
  docker?: DockerContainer[];
  dockerError?: string;
  systemInfo?: SystemInfo;
  systemInfoError?: string;
  networkInfo?: NetworkInfo;
  networkInfoError?: string;
};

/**
 * The physical machine an agent row belongs to.
 *
 * The server already returns one row per device; this is a safety net for
 * incremental events. The stable hardware identity comes first, so a machine
 * re-enrolled with a new key still collapses to one entry.
 */
export function deviceKey(agent: Agent) {
  return agent.identity ?? agent.deviceId ?? agent.id;
}

export function displayDeviceId(agent: Agent) {
  return deviceKey(agent);
}

/**
 * The label the list shows for a machine. Sorting by name has to use exactly
 * this, or the order would not match what the user can read on screen.
 */
export function agentDisplayName(agent: Agent) {
  return agent.fingerprint?.hostname ?? displayDeviceId(agent);
}

export type AgentSort = "name-asc" | "name-desc" | "last-connected-desc" | "last-connected-asc";

export const AGENT_SORTS: { value: AgentSort; label: string }[] = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "last-connected-desc", label: "Recently connected" },
  { value: "last-connected-asc", label: "Earliest connected" },
];

export const DEFAULT_AGENT_SORT: AgentSort = "name-asc";

export function isAgentSort(value: unknown): value is AgentSort {
  return AGENT_SORTS.some((option) => option.value === value);
}

/**
 * Orders the machine list. Returns a new array — the caller's list is state.
 *
 * The time sorts fall back to the name so the order is total: without a
 * tiebreak, rows with equal timestamps could swap places on an unrelated
 * re-render.
 */
export function sortAgents(agents: Agent[], sort: AgentSort): Agent[] {
  const byName = (a: Agent, b: Agent) =>
    agentDisplayName(a).localeCompare(agentDisplayName(b), undefined, { sensitivity: "base" });

  /**
   * A machine nobody has ever opened sorts last in *both* directions, rather
   * than being treated as timestamp 0. "Earliest connected" is a question it
   * has no answer to, so leading the list with it would misread as "this is
   * the one you have not touched in longest".
   */
  const byLastConnected = (a: Agent, b: Agent, newestFirst: boolean) => {
    if (a.lastConnectedAt === undefined || b.lastConnectedAt === undefined) {
      if (a.lastConnectedAt === b.lastConnectedAt) return byName(a, b);
      return a.lastConnectedAt === undefined ? 1 : -1;
    }
    const delta = newestFirst ? b.lastConnectedAt - a.lastConnectedAt : a.lastConnectedAt - b.lastConnectedAt;
    return delta || byName(a, b);
  };

  return [...agents].sort((a, b) => {
    switch (sort) {
      case "name-asc":
        return byName(a, b);
      case "name-desc":
        return byName(b, a);
      case "last-connected-desc":
        return byLastConnected(a, b, true);
      case "last-connected-asc":
        return byLastConnected(a, b, false);
    }
  });
}

export async function fetchAgents(apiBase: string = API_BASE): Promise<Agent[]> {
  const res = await authFetch(`${apiBase}/agents`);
  if (!res.ok) throw new Error("failed to fetch agents");
  return res.json();
}

export type AgentEvent =
  | { type: "agents"; agents: Agent[] }
  | { type: "agent"; agent: Agent }
  | { type: "pending"; pending: PendingDevice[] }
  /** A machine could not update itself; it will never report a new version. */
  | { type: "updateFailed"; agentId: string; error: string };

export type AgentEventHandlers = {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  /** Machines waiting for approval, pushed whenever the set changes. */
  onPending?: (pending: PendingDevice[]) => void;
  /** A machine reported that its update failed. */
  onUpdateFailed?: (agentId: string, error: string) => void;
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
          } else if (payload.type === "updateFailed") {
            handlers.onUpdateFailed?.(payload.agentId, payload.error);
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

/**
 * Asks a machine to upgrade itself to `version`.
 *
 * Returns as soon as the request is on the wire. The machine downloads,
 * swaps its binary and restarts, then reconnects reporting the new version —
 * so the list updating is what tells you it worked.
 */
export async function updateAgent(id: string, version?: string, apiBase: string = API_BASE): Promise<void> {
  const res = await authFetch(`${apiBase}/agents/${id}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(version ? { version } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "failed to request an update");
  }
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
