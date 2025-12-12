export type AgentStatus = "connecting" | "connected" | "disconnected";
export type AgentDirection = "inbound" | "outbound";

export interface AgentFingerprint {
  hostname: string;
  machineId?: string;
  macAddresses: string[];
  nics: string[];
}

export interface AgentRecord {
  id: string;
  address: string;
  connectionId: string;
  status: AgentStatus;
  lastSeen: number;
  fingerprint?: AgentFingerprint;
  remoteAgentId?: string;
  direction: AgentDirection;
}

export type ControlMessage =
  | { type: "hello"; token: string }
  | { type: "keystroke"; data: string }
  | { type: "reset" };

export type AgentMessage =
  | { type: "hello"; agentId: string; fingerprint: AgentFingerprint }
  | { type: "output"; data: string }
  | { type: "heartbeat" };
