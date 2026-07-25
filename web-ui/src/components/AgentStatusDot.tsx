import type { AgentStatus } from "../state/agents";
import { cn } from "../lib/utils";

type Props = {
  status: AgentStatus;
  className?: string;
};

const statusClassMap: Record<AgentStatus, string> = {
  connected: "status-dot--connected",
  connecting: "status-dot--connecting",
  pending: "status-dot--pending",
  disconnected: "status-dot--disconnected",
};

const statusLabelMap: Record<AgentStatus, string> = {
  connected: "connected",
  connecting: "connecting",
  pending: "pending approval",
  disconnected: "disconnected",
};

export function AgentStatusDot({ status, className }: Props) {
  const label = statusLabelMap[status];
  return (
    <span
      className={cn("inline-flex items-center", className)}
      aria-label={`Agent is ${label}`}
      title={label}
    >
      <span aria-hidden className={cn("status-dot", statusClassMap[status])} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
