import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Cpu, Gauge, HardDrive, MemoryStick, Monitor, Network, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { AgentStatusDot } from "./components/AgentStatusDot";
import { ThemeToggle } from "./components/ThemeToggle";
import { VersionFooter } from "./components/VersionFooter";
import type { Agent } from "./state/agents";
import {
  fetchAgents,
  refreshDockerInfo,
  refreshNetworkInfo,
  refreshSystemInfo,
  removeAgent,
  subscribeToAgentEvents,
} from "./state/agents";
import { getApiBase } from "./lib/api";
import {
  createAuthKey,
  enrollCommand,
  fetchConnectHost,
  listPendingDevices,
  type CreatedAuthKey,
  type PendingDevice,
} from "./state/enrollment";

const API_BASE = getApiBase();

export function formatTimestamp(ts: number) {
  const date = new Date(ts);
  return date.toLocaleTimeString();
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}

function formatDisk(free?: number, total?: number) {
  if (!free && !total) return "n/a";
  if (free && total) return `${formatBytes(free)} free / ${formatBytes(total)} total`;
  if (total) return `${formatBytes(total)} total`;
  return formatBytes(free);
}

function formatList(values?: string[]) {
  if (!values || values.length === 0) return "none";
  return values.join(", ");
}

function deviceKey(agent: Agent) {
  // The server already returns one row per physical device; this is a safety
  // net for incremental events. Prefer the stable hardware identity so a
  // machine re-enrolled with a new key still collapses to one row.
  return agent.identity ?? agent.deviceId ?? agent.id;
}

function displayDeviceId(agent: Agent) {
  return deviceKey(agent);
}

function dedupeAgents(list: Agent[]) {
  const priority: Record<Agent["status"], number> = {
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

function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [createdKey, setCreatedKey] = useState<CreatedAuthKey | null>(null);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectHost, setConnectHost] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const navigate = useNavigate();

  async function loadAgents() {
    try {
      const body = await fetchAgents(API_BASE);
      setAgents(body);
    } catch (err) {
      console.error("failed to load agents", err);
    }
  }

  useEffect(() => {
    refreshDockerInfo(API_BASE);
    refreshSystemInfo(API_BASE);
    refreshNetworkInfo(API_BASE);
    loadAgents();

    const loadPending = () =>
      listPendingDevices()
        .then(setPending)
        .catch(() => setPending([]));
    loadPending();
    const pendingTimer = setInterval(loadPending, 5000);

    fetchConnectHost().then(setConnectHost).catch(() => setConnectHost(null));

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
      API_BASE,
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

  async function handleRemoveAgent(agent: Agent) {
    if (!window.confirm("Remove this device? It will need to be enrolled again to reconnect.")) {
      return;
    }
    setRemovingId(agent.id);
    try {
      await removeAgent(agent.id, API_BASE);
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

  async function handleCreateAuthKey() {
    setIsCreatingKey(true);
    setKeyError(null);
    setCopied(false);
    try {
      setCreatedKey(await createAuthKey({ reusable: false }));
    } catch (err) {
      setKeyError((err as Error).message);
    } finally {
      setIsCreatingKey(false);
    }
  }

  const command = useMemo(
    () => (createdKey ? enrollCommand(createdKey.key, connectHost ?? API_BASE.replace(/^http/, "ws")) : ""),
    [createdKey, connectHost],
  );

  function copyCommand() {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Control server</p>
            <h1 className="text-2xl font-semibold tracking-tight">Spectre Control Panel</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="rounded-full">Live inbound + outbound</Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        {pending.length > 0 && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <p className="text-sm">
              {pending.length} machine{pending.length === 1 ? "" : "s"} waiting for approval
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {pending.map((p) => p.userCode).join(", ")}
              </span>
            </p>
            <Button size="sm" onClick={() => navigate("/enroll")}>
              Review
            </Button>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Add a machine</CardTitle>
            <CardDescription>
              Create an auth key and run the command on the machine you want to add. It dials out to this server, so it
              works behind NAT and firewalls.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {createdKey ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Run this on the machine you want to add:</p>
                <div className="flex items-center gap-2">
                  <code className="block flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-2 font-mono text-sm">
                    {command}
                  </code>
                  <Button variant="outline" size="sm" onClick={copyCommand} aria-label="Copy command">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Single use, expires {new Date(createdKey.expiresAt).toLocaleDateString()}. This key is shown once —
                  copy it now.
                </p>
                <Button variant="secondary" size="sm" onClick={() => setCreatedKey(null)}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Button onClick={handleCreateAuthKey} disabled={isCreatingKey}>
                  {isCreatingKey ? "Creating..." : "Create auth key"}
                </Button>
                {keyError && <p className="text-sm text-destructive">{keyError}</p>}
                <p className="text-xs text-muted-foreground">
                  No key handy? Run <code className="font-mono">spectre-agent up --host …</code> on the machine and
                  approve the code it prints.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connections</CardTitle>
            <CardDescription>Live connections from the control server into agent API servers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {dedupedAgents.length === 0 && <p className="text-sm text-muted-foreground">No connections yet.</p>}
            {dedupedAgents.map((agent) => (
              <div
                key={agent.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/agent/${agent.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/agent/${agent.id}`);
                  }
                }}
                className="flex w-full cursor-pointer flex-col gap-2 rounded-lg border bg-muted/40 p-4 text-left transition hover:border-primary"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <AgentStatusDot status={agent.status} />
                      {agent.agentVersion && (
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {agent.agentVersion}
                        </Badge>
                      )}
                      <p className="font-medium">{agent.fingerprint?.hostname ?? displayDeviceId(agent)}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{displayDeviceId(agent)}</p>
                    <p className="text-sm text-muted-foreground">{agent.address}</p>
                    <div className="flex flex-col gap-2 pt-2">
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
                    <div className="flex flex-col gap-2 pt-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Network Info</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {agent.networkInfo ? (
                          <>
                            <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground">
                              <Network size={14} /> IPv4: {formatList(agent.networkInfo.ipv4)}
                            </span>
                            {/* <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-foreground">
                              <Network size={14} /> IPv6: {formatList(agent.networkInfo.ipv6)}
                            </span> */}
                          </>
                        ) : agent.networkInfoError ? (
                          <span className="text-xs text-destructive">Network: {agent.networkInfoError}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Network info pending...</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 pt-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Docker Containers
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {agent.docker && agent.docker.length > 0 ? (
                          (agent.docker.sort((a, b) => a.name.localeCompare(b.name))).map((container) => (
                            <Badge key={container.name} variant="outline" className="text-xs font-normal">
                              <span className="font-medium text-foreground">{container.name}</span>
                              <span className="ml-1 text-muted-foreground">
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
                  <div className="flex flex-col items-end gap-2 text-right text-xs text-muted-foreground">
                    <p>Last seen: {formatTimestamp(agent.lastSeen)}</p>
                    {agent.status === "disconnected" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removingId === agent.id}
                        className="h-7 gap-1 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveAgent(agent);
                        }}
                      >
                        <Trash2 size={14} />
                        {removingId === agent.id ? "Removing..." : "Remove"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Connected</CardTitle>
              <CardDescription>Agents with an active control socket.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-3xl font-semibold">{connectedAgents.length}</p>
              <p className="text-sm text-muted-foreground">Including agents that have completed the handshake.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Disconnected</CardTitle>
              <CardDescription>Agents awaiting reconnection.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-3xl font-semibold">{disconnectedAgents.length}</p>
              <p className="text-sm text-muted-foreground">These connections will need a new attempt.</p>
            </CardContent>
          </Card>
        </div>
      </section>
      <VersionFooter apiBase={API_BASE} />
    </main>
  );
}

export default App;
