import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { AgentTerminal } from "./components/AgentTerminal";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "";

type AgentStatus = "connecting" | "connected" | "disconnected";

type AgentFingerprint = {
  hostname: string;
  machineId?: string;
  macAddresses: string[];
  nics: string[];
};

type Agent = {
  id: string;
  address: string;
  status: AgentStatus;
  lastSeen: number;
  fingerprint?: AgentFingerprint;
  remoteAgentId?: string;
};

export function formatTimestamp(ts: number) {
  const date = new Date(ts);
  return date.toLocaleTimeString();
}

export function statusVariant(status: AgentStatus) {
  if (status === "connected") return "outline" as const;
  if (status === "connecting") return "secondary" as const;
  return "destructive" as const;
}

function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("changeme");
  const [isConnecting, setIsConnecting] = useState(false);

  async function fetchAgents() {
    try {
      const res = await fetch(`${API_BASE}/agents`);
      const body = await res.json();
      setAgents(body);
    } catch (err) {
      console.error("failed to load agents", err);
    }
  }

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 3000);
    return () => clearInterval(interval);
  }, []);

  const connectedAgents = useMemo(() => agents.filter((a) => a.status === "connected"), [agents]);
  const disconnectedAgents = useMemo(() => agents.filter((a) => a.status === "disconnected"), [agents]);

  async function handleConnect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!address) return;
    setIsConnecting(true);
    try {
      await fetch(`${API_BASE}/agents/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address, token }),
      });
      setAddress("");
      await fetchAgents();
    } catch (err) {
      console.error("failed to connect", err);
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Control server</p>
            <h1 className="text-2xl font-semibold tracking-tight">Spectre Control Panel</h1>
          </div>
          <Badge variant="outline" className="rounded-full">Agent-initiated connections</Badge>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Connect to agent</CardTitle>
            <CardDescription>
              Enter the remote agent address (ws://host:port/ws) and optional token for the control server to connect.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleConnect}>
              <div className="flex flex-1 flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="address">
                  Agent WebSocket URL
                </label>
                <input
                  id="address"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="ws://10.0.0.12:8081/ws"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="token">
                  Token
                </label>
                <input
                  id="token"
                  className="w-48 rounded-md border bg-background px-3 py-2 text-sm"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isConnecting}>
                  {isConnecting ? "Connecting..." : "Connect"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connections</CardTitle>
            <CardDescription>Live connections from the control server into agent API servers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {agents.length === 0 && <p className="text-sm text-muted-foreground">No connections yet.</p>}
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="flex flex-col gap-4 rounded-lg border bg-muted/40 p-4"
              >
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(agent.status)} className="capitalize">
                        {agent.status}
                      </Badge>
                      <p className="font-medium">{agent.remoteAgentId ?? agent.id}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{agent.address}</p>
                    {agent.fingerprint && (
                      <p className="text-xs text-muted-foreground">
                        Hostname: {agent.fingerprint.hostname} • Interfaces: {agent.fingerprint.nics.join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">Last seen: {formatTimestamp(agent.lastSeen)}</div>
                </div>
                <AgentTerminal agentId={agent.id} apiBase={API_BASE} connected={agent.status === "connected"} />
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
    </main>
  );
}

export default App;
