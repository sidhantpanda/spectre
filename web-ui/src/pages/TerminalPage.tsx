import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { AgentTerminal } from "../components/AgentTerminal";
import { Agent, fetchAgents, subscribeToAgentEvents } from "../state/agents";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) && (import.meta.env.VITE_API_BASE as string).length > 0
    ? (import.meta.env.VITE_API_BASE as string)
    : window.location.origin;

export default function TerminalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    let mounted = true;
    fetchAgents(API_BASE).then((list) => mounted && setAgents(list)).catch(() => {});
    const socket = subscribeToAgentEvents(
      (list) => mounted && setAgents(list),
      (agent) => {
        if (!mounted) return;
        setAgents((prev) => {
          const next = [...prev];
          const idx = next.findIndex((a) => a.id === agent.id);
          if (idx === -1) {
            next.push(agent);
          } else {
            next[idx] = agent;
          }
          return next;
        });
      },
      API_BASE,
    );
    return () => {
      mounted = false;
      socket.close();
    };
  }, []);

  const agent = useMemo(() => agents.find((a) => a.id === id), [agents, id]);
  const currentId = agent?.id ?? id ?? "";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => navigate("/")}>
              ← Back
            </Button>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Agent terminal</p>
              <h1 className="text-xl font-semibold tracking-tight">{agent?.remoteAgentId ?? agent?.id ?? id}</h1>
            </div>
          </div>
          {agent && (
            <Badge variant={agent.status === "connected" ? "outline" : "destructive"} className="capitalize">
              {agent.status}
            </Badge>
          )}
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-6 py-6">
        {!agent && <p className="text-sm text-muted-foreground">Agent not found.</p>}
        {agent && (
          <AgentTerminal
            key={currentId}
            agentId={currentId}
            apiBase={API_BASE}
            connectionId={agent.connectionId}
            enabled={agent.status === "connected"}
          />
        )}
      </section>
    </main>
  );
}
