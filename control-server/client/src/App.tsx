import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Github, MonitorCog, PlugZap, Power } from "lucide-react";

type AgentStatus = "connected" | "disconnected";

type Agent = {
  id: string;
  hostname: string;
  status: AgentStatus;
  platform: string;
  ip: string;
  lastSeen: string;
};

const agents: Agent[] = [
  {
    id: "alpha-01",
    hostname: "alpha-control",
    status: "connected",
    platform: "Windows 11",
    ip: "10.0.1.14",
    lastSeen: "just now",
  },
  {
    id: "bravo-02",
    hostname: "bravo-ops",
    status: "connected",
    platform: "Ubuntu 22.04",
    ip: "10.0.2.88",
    lastSeen: "2 minutes ago",
  },
  {
    id: "charlie-03",
    hostname: "charlie-lab",
    status: "disconnected",
    platform: "macOS 14",
    ip: "10.0.3.45",
    lastSeen: "18 minutes ago",
  },
  {
    id: "delta-04",
    hostname: "delta-field",
    status: "connected",
    platform: "Debian 12",
    ip: "10.0.4.67",
    lastSeen: "6 minutes ago",
  },
  {
    id: "echo-05",
    hostname: "echo-remote",
    status: "disconnected",
    platform: "Windows Server 2022",
    ip: "10.0.5.19",
    lastSeen: "42 minutes ago",
  },
];

const connectedAgents = agents.filter((agent) => agent.status === "connected");
const disconnectedAgents = agents.filter((agent) => agent.status === "disconnected");

function App() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Control server</p>
            <h1 className="text-2xl font-semibold tracking-tight">Spectre Control Panel</h1>
          </div>
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a href="https://github.com" target="_blank" rel="noreferrer">
              <Github className="h-4 w-4" />
              Repository
            </a>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Agent overview</h2>
            <p className="text-sm text-muted-foreground">Track which agents are currently connected to the control server.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <MonitorCog className="h-4 w-4" />
              Manage agents
            </Button>
            <Button size="sm" className="gap-2">
              <PlugZap className="h-4 w-4" />
              Add connection
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle className="text-sm font-medium text-muted-foreground">Connected agents</CardTitle>
                <div className="mt-1 flex items-center gap-2 text-3xl font-semibold">
                  {connectedAgents.length}
                  <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-xs text-emerald-700">
                    Live
                  </Badge>
                </div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <PlugZap className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{connectedAgents.length} agents are actively reporting telemetry.</p>
              <p>Use the quick actions to message, isolate, or update a connected host.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle className="text-sm font-medium text-muted-foreground">Disconnected agents</CardTitle>
                <div className="mt-1 flex items-center gap-2 text-3xl font-semibold">
                  {disconnectedAgents.length}
                  <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-xs text-amber-700">
                    Attention
                  </Badge>
                </div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <Power className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>These agents stopped reporting. Confirm connectivity or schedule a restart.</p>
              <p>Recent disconnects can be triaged directly from the panel below.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Connected agents</CardTitle>
            <CardDescription>Hosts currently communicating with the control server.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {connectedAgents.map((agent) => (
              <div
                key={agent.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden />
                  <div>
                    <p className="font-medium leading-none">{agent.hostname}</p>
                    <p className="text-sm text-muted-foreground">{agent.platform} • {agent.ip}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
                    Connected
                  </Badge>
                  <span>Last seen {agent.lastSeen}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Disconnected agents</CardTitle>
            <CardDescription>Agents that have not reported recently and may need follow-up.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {disconnectedAgents.map((agent) => (
              <div
                key={agent.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden />
                  <div>
                    <p className="font-medium leading-none">{agent.hostname}</p>
                    <p className="text-sm text-muted-foreground">{agent.platform} • {agent.ip}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
                    Disconnected
                  </Badge>
                  <span>Last seen {agent.lastSeen}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

export default App;
