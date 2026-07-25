import { useState } from "react";
import { ChevronDown, Cpu, Gauge, HardDrive, MemoryStick, Monitor, Network, Trash2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { AgentStatusDot } from "./AgentStatusDot";
import { displayDeviceId, type Agent } from "../state/agents";
import { formatBytes, formatDisk, formatList, formatTimestamp } from "../lib/format";

type Props = {
  agent: Agent;
  removing?: boolean;
  onOpen: () => void;
  onRemove: () => void;
};

/**
 * A short line describing the machine: what it runs and how big it is.
 *
 * The full inventory is a wall of chips, and a list of machines is meant to be
 * scanned, so the summary carries only what distinguishes one host from another
 * and the rest waits behind "Show more".
 */
function summarize(agent: Agent) {
  const parts: string[] = [];
  if (agent.address) parts.push(agent.address);
  if (agent.systemInfo) {
    parts.push(agent.systemInfo.os);
    parts.push(`${agent.systemInfo.cores} cores (${agent.systemInfo.arch})`);
    parts.push(formatBytes(agent.systemInfo.memoryBytes));
  }
  if (agent.docker && agent.docker.length > 0) {
    parts.push(`${agent.docker.length} container${agent.docker.length === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export function AgentListItem({ agent, removing, onOpen, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = `agent-details-${agent.id}`;
  // Sorted on a copy: sorting agent.docker in place mutates the record held in
  // React state.
  const containers = [...(agent.docker ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="flex w-full cursor-pointer flex-col gap-2 rounded-lg border bg-muted/40 p-4 text-left transition hover:border-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <AgentStatusDot status={agent.status} />
            {agent.agentVersion && (
              <Badge variant="outline" className="font-mono text-[11px]">
                {agent.agentVersion}
              </Badge>
            )}
            <p className="font-medium">{agent.fingerprint?.hostname ?? displayDeviceId(agent)}</p>
            {agent.status === "connecting" && (
              <Badge variant="outline" className="border-amber-500/50 text-[11px]">
                Approved — connecting
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{summarize(agent)}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 text-right text-xs text-muted-foreground">
          <p>
            {agent.status === "connecting" ? "Enrolled" : "Last seen"}: {formatTimestamp(agent.lastSeen)}
          </p>
          {agent.status !== "connected" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={removing}
              className="h-7 gap-1 text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 size={14} />
              {removing ? "Removing..." : "Remove"}
            </Button>
          )}
        </div>
      </div>

      <div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          aria-expanded={expanded}
          aria-controls={detailsId}
          // The card itself opens a terminal; expanding must not do that too.
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((open) => !open);
          }}
        >
          <ChevronDown size={14} className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
          {expanded ? "Show less" : "Show more"}
        </Button>
      </div>

      {expanded && (
        <div id={detailsId} className="space-y-3 border-t pt-3">
          <p className="break-all text-sm text-muted-foreground">{displayDeviceId(agent)}</p>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">System Info</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {agent.systemInfo ? (
                <>
                  <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground">
                    <Monitor size={14} /> {agent.systemInfo.os}
                    {agent.systemInfo.version && (
                      <span className="text-muted-foreground"> {agent.systemInfo.version}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground">
                    <Cpu size={14} /> {agent.systemInfo.cpu || "CPU"}
                  </span>
                  <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground">
                    <Gauge size={14} /> {agent.systemInfo.cores} cores ({agent.systemInfo.arch})
                  </span>
                  <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground">
                    <MemoryStick size={14} /> {formatBytes(agent.systemInfo.memoryBytes)}
                  </span>
                  <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground">
                    <HardDrive size={14} /> {formatDisk(agent.systemInfo.diskFreeBytes, agent.systemInfo.diskTotalBytes)}
                  </span>
                </>
              ) : agent.systemInfoError ? (
                <span className="text-xs text-destructive">System: {agent.systemInfoError}</span>
              ) : (
                <span className="text-xs text-muted-foreground">System info pending...</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Network Info</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {agent.networkInfo ? (
                <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground">
                  <Network size={14} /> IPv4: {formatList(agent.networkInfo.ipv4)}
                </span>
              ) : agent.networkInfoError ? (
                <span className="text-xs text-destructive">Network: {agent.networkInfoError}</span>
              ) : (
                <span className="text-xs text-muted-foreground">Network info pending...</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Docker Containers</p>
            <div className="flex flex-wrap items-center gap-2">
              {containers.length > 0 ? (
                containers.map((container) => (
                  <Badge key={container.name} variant="outline" className="text-xs font-normal">
                    <span className="font-medium text-foreground">{container.name}</span>
                    <span className="ml-1 break-all text-muted-foreground">
                      {(container.ports ?? []).length > 0 ? container.ports.join(", ") : "no ports"}
                    </span>
                  </Badge>
                ))
              ) : agent.dockerError ? (
                <span className="text-xs text-destructive">Docker: {agent.dockerError}</span>
              ) : (
                <span className="text-xs text-muted-foreground">Docker: no containers reported</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
