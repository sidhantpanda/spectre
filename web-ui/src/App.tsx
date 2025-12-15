import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { AgentStatusDot } from "./components/AgentStatusDot";
import type { Agent } from "./state/agents";
import { fetchAgents, subscribeToAgentEvents } from "./state/agents";
import { getApiBase } from "./lib/api";

const API_BASE = getApiBase();

export function formatTimestamp(ts: number) {
  const date = new Date(ts);
  return date.toLocaleTimeString();
}

function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("changeme");
  const [isConnecting, setIsConnecting] = useState(false);
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
    loadAgents();
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
    return () => socket.close();
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
      await loadAgents();
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
          <Badge variant="outline" className="rounded-full">Live inbound + outbound</Badge>
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
              <button
                key={agent.id}
                onClick={() => navigate(`/agent/${agent.id}`)}
                className="flex w-full flex-col gap-2 rounded-lg border bg-muted/40 p-4 text-left transition hover:border-primary"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <AgentStatusDot status={agent.status} />
                      <Badge variant="secondary" className="capitalize">
                        {agent.direction}
                      </Badge>
                      <p className="font-medium">{agent.remoteAgentId ?? agent.id}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{agent.address}</p>
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    <p>Last seen: {formatTimestamp(agent.lastSeen)}</p>
                    {agent.fingerprint && (
                      <p>Hostname: {agent.fingerprint.hostname}</p>
                    )}
                  </div>
                </div>
              </button>
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
