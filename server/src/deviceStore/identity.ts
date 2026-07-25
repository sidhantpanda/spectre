import { type AgentFingerprint } from "../types";

/**
 * Derives a stable identity for a machine from what the agent reports.
 *
 * Precedence, most stable first: the Linux machine-id, then the sorted set of
 * MAC addresses (order-independent), then the agent's persistent device id.
 * This is what makes a reconnect — or a re-enrollment with a fresh key — resolve
 * to the same device instead of a new one.
 */
export function computeIdentity(
  fingerprint: AgentFingerprint | undefined,
  agentDeviceId: string | undefined,
): { identity: string; machineId?: string; primaryMac?: string } {
  const machineId = fingerprint?.machineId?.trim();
  const macs = (fingerprint?.macAddresses ?? [])
    .map((m) => m.trim().toLowerCase())
    .filter((m) => m.length > 0 && m !== "00:00:00:00:00:00")
    .sort();
  const primaryMac = macs[0];

  if (machineId) return { identity: `mid:${machineId}`, machineId, primaryMac };
  if (macs.length > 0) return { identity: `mac:${macs.join(",")}`, primaryMac };
  if (agentDeviceId) return { identity: `aid:${agentDeviceId}`, primaryMac };
  return { identity: "", primaryMac };
}
