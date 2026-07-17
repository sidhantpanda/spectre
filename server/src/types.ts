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
  agentVersion?: string;
  fingerprint?: AgentFingerprint;
  docker?: DockerContainer[];
  dockerError?: string;
  systemInfo?: SystemInfo;
  systemInfoError?: string;
  networkInfo?: NetworkInfo;
  networkInfoError?: string;
}

/** Server to agent. */
export type ControlMessage =
  | { type: "hello" }
  /** Handed to an agent that connected with an auth key; carries its device key. */
  | { type: "enrolled"; deviceKey: string }
  | { type: "keystroke"; data: string; sessionId?: string }
  | { type: "reset"; sessionId?: string }
  | { type: "dockerInfo" }
  | { type: "systemInfo" }
  | { type: "networkInfo" };

/** Agent to server. */
export type AgentMessage =
  | { type: "hello"; agentId: string; fingerprint: AgentFingerprint; agentVersion?: string }
  | { type: "output"; data: string; sessionId?: string }
  | { type: "heartbeat" }
  | { type: "dockerInfo"; containers?: DockerContainer[]; error?: string }
  | { type: "systemInfo"; systemInfo?: SystemInfo; error?: string }
  | { type: "networkInfo"; networkInfo?: NetworkInfo; error?: string };
