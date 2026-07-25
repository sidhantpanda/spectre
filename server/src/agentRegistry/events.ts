import { canonicalAgentRecordFor, listAgentRecords } from "../deviceStore";
import { type AgentMessage, type AgentRecord } from "../types";

const statusListeners: Set<(record: AgentRecord) => void> = new Set();
const outputListeners: Set<(agentId: string, payload: AgentMessage) => void> = new Set();

export function onAgentStatusChange(listener: (record: AgentRecord) => void) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function onAgentOutput(listener: (agentId: string, payload: AgentMessage) => void) {
  outputListeners.add(listener);
  return () => outputListeners.delete(listener);
}

export function emitOutput(agentId: string, payload: AgentMessage) {
  for (const listener of outputListeners) listener(agentId, payload);
}

/** Emits the canonical (deduped) record for whichever device this row belongs to. */
export function emitDeviceUpdate(deviceStoreId: string) {
  const record = canonicalAgentRecordFor(deviceStoreId);
  if (!record) return;
  for (const listener of statusListeners) listener(record);
}

export function listAgents(): AgentRecord[] {
  return listAgentRecords();
}

/** Resolves the device shown in the UI for a given id (used by the terminal WS). */
export function currentAgent(agentId: string): { record: AgentRecord } | undefined {
  const record = canonicalAgentRecordFor(agentId);
  return record ? { record } : undefined;
}
