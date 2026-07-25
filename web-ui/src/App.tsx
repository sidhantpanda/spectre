import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { AgentListItem } from "./components/AgentListItem";
import { AgentStatusDot } from "./components/AgentStatusDot";
import { ThemeToggle } from "./components/ThemeToggle";
import { VersionFooter } from "./components/VersionFooter";
import type { Agent } from "./state/agents";
import {
  deviceKey,
  fetchAgents,
  refreshDockerInfo,
  refreshNetworkInfo,
  refreshSystemInfo,
  removeAgent,
  subscribeToAgentEvents,
} from "./state/agents";
import { getApiBase } from "./lib/api";
import {
  approveDevice,
  createAuthKey,
  denyDevice,
  enrollCommand,
  fetchConnectHost,
  listPendingDevices,
  type CreatedAuthKey,
  type PendingDevice,
} from "./state/enrollment";

const API_BASE = getApiBase();

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

function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [createdKey, setCreatedKey] = useState<CreatedAuthKey | null>(null);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectHost, setConnectHost] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingBusy, setPendingBusy] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
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

    // The socket pushes these as they happen; the poll is a fallback for a
    // dropped socket, not the primary path.
    const loadPending = () =>
      listPendingDevices()
        .then(setPending)
        .catch(() => setPending([]));
    loadPending();
    const pendingTimer = setInterval(loadPending, 15000);

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
      { onPending: setPending },
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
    // A column at least as tall as the viewport, with the content growing to
    // fill it: the footer lands on the bottom edge on a short page and below
    // the fold on a long one, without being pinned there.
    <main className="flex min-h-screen flex-col bg-background text-foreground">
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

      <section className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 space-y-8">
        {pending.length > 0 && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            {pending.length} machine{pending.length === 1 ? "" : "s"} waiting for approval — approve or reject below.
          </p>
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
                  approve the code it prints — it appears in the list below, or{" "}
                  <button type="button" className="underline underline-offset-4" onClick={() => navigate("/enroll")}>
                    enter it by hand
                  </button>
                  .
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
            {dedupedAgents.length === 0 && pending.length === 0 && (
              <p className="text-sm text-muted-foreground">No connections yet.</p>
            )}

            {pendingError && <p className="text-sm text-destructive">{pendingError}</p>}

            {/* Machines that have asked to join. They have no credential yet, so
                there is nothing to open — only a decision to make. */}
            {pending.map((device) => (
              <div
                key={device.id}
                className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <AgentStatusDot status="pending" />
                    <p className="font-medium">{device.hostname ?? "unknown host"}</p>
                    <Badge variant="outline" className="border-amber-500/50 text-[11px]">
                      Pending approval
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Code <span className="font-mono tracking-widest text-foreground">{device.userCode}</span> — confirm
                    it matches what the machine printed.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Expires at {new Date(device.expiresAt).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    disabled={pendingBusy === device.userCode}
                    onClick={() => void handleApprovePending(device)}
                  >
                    {pendingBusy === device.userCode ? "Working..." : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={pendingBusy === device.userCode}
                    onClick={() => void handleRejectPending(device)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}

            {dedupedAgents.map((agent) => (
              <AgentListItem
                key={agent.id}
                agent={agent}
                removing={removingId === agent.id}
                onOpen={() => navigate(`/agent/${agent.id}`)}
                onRemove={() => handleRemoveAgent(agent)}
              />
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
