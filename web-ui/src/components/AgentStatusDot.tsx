import type { AgentStatus } from "../state/agents";
import { cn } from "../lib/utils";

type Props = {
  status: AgentStatus;
  className?: string;
};

const statusClassMap: Record<AgentStatus, string> = {
  connected: "status-dot--connected",
  connecting: "status-dot--connecting",
  disconnected: "status-dot--disconnected",
};

export function AgentStatusDot({ status, className }: Props) {
  return (
    <span
      className={cn("inline-flex items-center", className)}
      aria-label={`Agent is ${status}`}
      title={status}
    >
      <span aria-hidden className={cn("status-dot", statusClassMap[status])} />
      <span className="sr-only">{status}</span>
    </span>
  );
}
