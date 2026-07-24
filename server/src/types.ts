export type AgentStatus = "connecting" | "connected" | "disconnected";

export interface AgentFingerprint {
  hostname: string;
  machineId?: string;
  macAddresses: string[];
  nics: string[];
}

export interface DockerContainer {
  name: string;
  ports: string[];
}

export interface SystemInfo {
  os: string;
  version: string;
  cpu: string;
  arch: string;
  cores: number;
  memoryBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  tmuxAvailable?: boolean;
}

export interface NetworkInfo {
  ipv4: string[];
  ipv6: string[];
}

export interface AgentRecord {
  id: string;
  address: string;
  connectionId: string;
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
}

/** A row from the connection history. */
export interface ConnectionRecord {
  id: string;
  deviceId: string;
  address?: string;
  connectedAt: number;
  disconnectedAt?: number;
  closeReason?: string;
}

/**
 * One attachable terminal session on an agent's host.
 *
 * `id` is the tmux session name. Sessions Spectre created are named
 * `spectre-<uuid>` and reported with `managed: true`; sessions the user started
 * themselves keep their own names and are listed too, so they can be attached
 * to from the browser.
 */
export interface SessionInfo {
  id: string;
  /** Unix seconds, from tmux. Absent for raw (non-tmux) shells. */
  createdAt?: number;
  /** Whether any tmux client is currently viewing it. */
  attached: boolean;
  windows?: number;
  /** True for sessions Spectre created, false for pre-existing ones. */
  managed: boolean;
  /** True when the agent process currently holds a PTY for it. */
  live: boolean;
}

/** Server to agent. */
export type ControlMessage =
  | { type: "hello" }
  /** Handed to an agent that connected with an auth key; carries its device key. */
  | { type: "enrolled"; deviceKey: string }
  | { type: "keystroke"; data: string; sessionId?: string }
  /** Asks the agent to enumerate every tmux session on its host. */
  | { type: "listSessions" }
  /** Opens a new session; the server mints the `spectre-<uuid>` name. */
  | { type: "createSession"; sessionId: string }
  /** Attaches to an existing session, creating it if it has since vanished. */
  | { type: "attachSession"; sessionId: string }
  /** Tears a session down for good (tmux kill-session). */
  | { type: "killSession"; sessionId: string }
  /** Legacy alias for attachSession, still understood by older agents. */
  | { type: "reset"; sessionId?: string }
  | { type: "dockerInfo" }
  | { type: "systemInfo" }
  | { type: "networkInfo" };

/** Agent to server. */
export type AgentMessage =
  | { type: "hello"; agentId: string; fingerprint: AgentFingerprint; agentVersion?: string }
  | { type: "output"; data: string; sessionId?: string }
  | { type: "heartbeat" }
  | { type: "sessions"; sessions?: SessionInfo[]; tmuxAvailable?: boolean }
  | { type: "sessionOpened"; sessionId: string }
  | { type: "sessionClosed"; sessionId: string }
  /** The PTY ended (shell exited or tmux detached); the session may still exist. */
  | { type: "sessionExited"; sessionId: string }
  | { type: "dockerInfo"; containers?: DockerContainer[]; error?: string }
  | { type: "systemInfo"; systemInfo?: SystemInfo; error?: string }
  | { type: "networkInfo"; networkInfo?: NetworkInfo; error?: string };
