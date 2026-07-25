import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { AgentListItem } from "./AgentListItem";
import { PendingDeviceItem } from "./PendingDeviceItem";
import type { Agent } from "../state/agents";
import { type PendingDevice } from "../state/enrollment";

type Props = {
  dedupedAgents: Agent[];
  pending: PendingDevice[];
  pendingError: string | null;
  pendingBusy: string | null;
  removingId: string | null;
  onApprovePending: (device: PendingDevice) => void;
  onRejectPending: (device: PendingDevice) => void;
  onOpenAgent: (agent: Agent) => void;
  onRemoveAgent: (agent: Agent) => void;
};

/** The Connections card: empty state, pending rows, and the agent list. */
export function ConnectionsCard({
  dedupedAgents,
  pending,
  pendingError,
  pendingBusy,
  removingId,
  onApprovePending,
  onRejectPending,
  onOpenAgent,
  onRemoveAgent,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connections</CardTitle>
        <CardDescription>Live connections from the control server into agent API servers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {dedupedAgents.length === 0 && pending.length === 0 && (
          <p className="text-sm text-muted-foreground">No connections yet.</p>
        )}

        {pendingError && <p className="text-sm text-destructive">{pendingError}</p>}

        {/* Machines that have asked to join. They have no credential yet, so
            there is nothing to open — only a decision to make. */}
        {pending.map((device) => (
          <PendingDeviceItem
            key={device.id}
            device={device}
            busy={pendingBusy === device.userCode}
            onApprove={() => onApprovePending(device)}
            onReject={() => onRejectPending(device)}
          />
        ))}

        {dedupedAgents.map((agent) => (
          <AgentListItem
            key={agent.id}
            agent={agent}
            removing={removingId === agent.id}
            onOpen={() => onOpenAgent(agent)}
            onRemove={() => onRemoveAgent(agent)}
          />
        ))}
      </CardContent>
    </Card>
  );
}
