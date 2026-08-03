import { getLatestAgentVersion, updateAvailableFor } from "../agentRelease";
import { canonicalAgentRecordFor, listAgentRecords } from "../deviceStore";
import { type AgentMessage, type AgentRecord } from "../types";

/**
 * Adds "is this machine running what we currently ship". Applied here rather
 * than in the device store because the answer comes from GitHub, not from any
 * device row — and applied at every exit so the REST list and the live event
 * stream agree.
 */
function withReleaseInfo(record: AgentRecord): AgentRecord {
  const latest = getLatestAgentVersion();
  return {
    ...record,
    latestAgentVersion: latest,
    updateAvailable: updateAvailableFor(record.agentVersion, latest),
  };
}

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

const updateFailureListeners: Set<(agentId: string, error: string) => void> = new Set();

export function onAgentUpdateFailure(listener: (agentId: string, error: string) => void) {
  updateFailureListeners.add(listener);
  return () => updateFailureListeners.delete(listener);
}

/** A machine reported that it could not update itself. */
export function emitUpdateFailure(agentId: string, error: string) {
  for (const listener of updateFailureListeners) listener(agentId, error);
}

/** Emits the canonical (deduped) record for whichever device this row belongs to. */
export function emitDeviceUpdate(deviceStoreId: string) {
  const record = canonicalAgentRecordFor(deviceStoreId);
  if (!record) return;
  const decorated = withReleaseInfo(record);
  for (const listener of statusListeners) listener(decorated);
}

export function listAgents(): AgentRecord[] {
  return listAgentRecords().map(withReleaseInfo);
}

/** Resolves the device shown in the UI for a given id (used by the terminal WS). */
export function currentAgent(agentId: string): { record: AgentRecord } | undefined {
  const record = canonicalAgentRecordFor(agentId);
  return record ? { record: withReleaseInfo(record) } : undefined;
}
