import { useEffect, useMemo, useState } from "react";
import type { Agent } from "../state/agents";
import {
  deviceKey,
  fetchAgents,
  refreshDockerInfo,
  refreshNetworkInfo,
  refreshSystemInfo,
  removeAgent,
  subscribeToAgentEvents,
  updateAgent,
} from "../state/agents";
import { approveDevice, denyDevice, listPendingDevices, type PendingDevice } from "../state/enrollment";

function dedupeAgents(list: Agent[]) {
  const priority: Record<Agent["status"], number> = {
    // "pending" never reaches here — it belongs to machines that have no device
    // row yet — but the map has to cover the type.
    pending: 0,
    disconnected: 0,
    connecting: 1,
    connected: 2,
  };
  const map = new Map<string, Agent>();
  for (const agent of list) {
    const key = deviceKey(agent);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, agent);
      continue;
    }
    const existingScore = priority[existing.status];
    const nextScore = priority[agent.status];
    if (nextScore > existingScore || (nextScore === existingScore && agent.lastSeen > existing.lastSeen)) {
      map.set(key, agent);
    }
  }
  return Array.from(map.values());
}

/**
 * Agent + pending-device state for the dashboard: the events subscription, the
 * polling fallback, and the approve/reject/remove actions.
 */
export function useDashboard(apiBase: string) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Machines told to update, against the version they were on when asked. An
  // update ends with the agent restarting and reconnecting, so "done" is that
  // machine reporting a different version — not the POST returning.
  const [updating, setUpdating] = useState<Record<string, string>>({});
  // Why an update did not happen, kept next to the machine it belongs to.
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});
  const [pendingBusy, setPendingBusy] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  async function loadAgents() {
    try {
      const body = await fetchAgents(apiBase);
      setAgents(body);
    } catch (err) {
      console.error("failed to load agents", err);
    }
  }

  useEffect(() => {
    refreshDockerInfo(apiBase);
    refreshSystemInfo(apiBase);
    refreshNetworkInfo(apiBase);
    loadAgents();

    // The socket pushes these as they happen; the poll is a fallback for a
    // dropped socket, not the primary path.
    const loadPending = () =>
      listPendingDevices()
        .then(setPending)
        .catch(() => setPending([]));
    loadPending();
    const pendingTimer = setInterval(loadPending, 15000);

    const socket = subscribeToAgentEvents(
      (list) => setAgents(list),
      (agent) =>
        setAgents((prev) => {
          const next = [...prev];
          const idx = next.findIndex((a) => a.id === agent.id);
          if (idx === -1) {
            next.push(agent);
          } else {
            next[idx] = agent;
          }
          return next;
        }),
      apiBase,
      {
        onPending: setPending,
        // A failed update never produces a new version, so nothing else would
        // ever clear the button's progress state.
        onUpdateFailed: (agentId, error) => {
          setUpdating((prev) => {
            if (!(agentId in prev)) return prev;
            const next = { ...prev };
            delete next[agentId];
            return next;
          });
          setUpdateErrors((prev) => ({ ...prev, [agentId]: error }));
        },
      },
    );
    return () => {
      clearInterval(pendingTimer);
      socket.close();
    };
  }, []);

  const dedupedAgents = useMemo(() => dedupeAgents(agents), [agents]);
  const connectedAgents = useMemo(() => dedupedAgents.filter((a) => a.status === "connected"), [dedupedAgents]);
  const disconnectedAgents = useMemo(
    () => dedupedAgents.filter((a) => a.status === "disconnected"),
    [dedupedAgents],
  );

  // Clear the "Updating..." state once a machine comes back on a new version.
  useEffect(() => {
    setUpdating((prev) => {
      const entries = Object.entries(prev).filter(([id, versionWhenAsked]) => {
        const agent = dedupedAgents.find((a) => a.id === id);
        // Gone from the list entirely: nothing left to show a spinner on.
        if (!agent) return false;
        return agent.agentVersion === versionWhenAsked;
      });
      return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
    });
  }, [dedupedAgents]);

  async function handleUpdateAgent(agent: Agent) {
    setUpdating((prev) => ({ ...prev, [agent.id]: agent.agentVersion ?? "" }));
    setUpdateErrors((prev) => {
      const next = { ...prev };
      delete next[agent.id];
      return next;
    });
    try {
      await updateAgent(agent.id, agent.latestAgentVersion, apiBase);
    } catch (err) {
      console.error("failed to request an update", err);
      window.alert((err as Error).message);
      setUpdating((prev) => {
        const next = { ...prev };
        delete next[agent.id];
        return next;
      });
    }
  }

  async function handleRemoveAgent(agent: Agent) {
    if (!window.confirm("Remove this device? It will need to be enrolled again to reconnect.")) {
      return;
    }
    setRemovingId(agent.id);
    try {
      await removeAgent(agent.id, apiBase);
      // Drop every raw row for this physical device, not just the clicked id;
      // incremental events can leave more than one in local state.
      const key = deviceKey(agent);
      setAgents((prev) => prev.filter((a) => deviceKey(a) !== key));
    } catch (err) {
      console.error("failed to remove device", err);
      window.alert((err as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  // Approving mints the machine's credential, so the row it becomes arrives on
  // the next agent refresh rather than from the pending list.
  async function handleApprovePending(device: PendingDevice) {
    setPendingBusy(device.userCode);
    setPendingError(null);
    try {
      await approveDevice(device.userCode, device.hostname);
      setPending((prev) => prev.filter((p) => p.userCode !== device.userCode));
      await loadAgents();
    } catch (err) {
      setPendingError((err as Error).message);
    } finally {
      setPendingBusy(null);
    }
  }

  async function handleRejectPending(device: PendingDevice) {
    setPendingBusy(device.userCode);
    setPendingError(null);
    try {
      await denyDevice(device.userCode);
      setPending((prev) => prev.filter((p) => p.userCode !== device.userCode));
    } catch (err) {
      setPendingError((err as Error).message);
    } finally {
      setPendingBusy(null);
    }
  }

  return {
    dedupedAgents,
    connectedAgents,
    disconnectedAgents,
    pending,
    removingId,
    updating,
    updateErrors,
    pendingBusy,
    pendingError,
    handleUpdateAgent,
    handleRemoveAgent,
    handleApprovePending,
    handleRejectPending,
  };
}
