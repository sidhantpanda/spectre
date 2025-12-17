export type AgentStatus = "connecting" | "connected" | "disconnected";
export type AgentDirection = "inbound" | "outbound";

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

export interface AgentRecord {
  id: string;
  address: string;
  connectionId: string;
  status: AgentStatus;
  lastSeen: number;
  deviceId?: string;
  fingerprint?: AgentFingerprint;
  remoteAgentId?: string;
  direction: AgentDirection;
  docker?: DockerContainer[];
  dockerError?: string;
}

export type ControlMessage =
  | { type: "hello"; token: string }
  | { type: "keystroke"; data: string; sessionId?: string }
  | { type: "reset"; sessionId?: string }
  | { type: "dockerInfo" };

export type AgentMessage =
  | { type: "hello"; agentId: string; fingerprint: AgentFingerprint }
  | { type: "output"; data: string; sessionId?: string }
  | { type: "heartbeat" }
  | { type: "dockerInfo"; containers?: DockerContainer[]; error?: string };
