export type AgentStatus = "connected" | "disconnected";

export interface AgentFingerprint {
  hostname: string;
  machineId?: string;
  macAddresses: string[];
  nics: string[];
}

export interface AgentRecord {
  id: string;
  status: AgentStatus;
  lastSeen: number;
  fingerprint: AgentFingerprint;
}

export type ServerMessage =
  | { type: "keystroke"; data: string }
  | { type: "ping" };

export type AgentMessage =
  | { type: "hello"; token: string; agentId: string; fingerprint: AgentFingerprint }
  | { type: "output"; data: string }
  | { type: "heartbeat" };
