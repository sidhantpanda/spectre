import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { AgentTerminal } from "../components/AgentTerminal";
import { AgentStatusDot } from "../components/AgentStatusDot";
import { Agent, fetchAgents, subscribeToAgentEvents } from "../state/agents";
import { getApiBase } from "../lib/api";

const API_BASE = getApiBase();

export default function TerminalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let backoff = 1000;

    const cleanupSocket = () => {
      if (socket) {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
        socket = null;
      }
    };

    const scheduleRetry = () => {
      if (!mounted) return;
      cleanupSocket();
      setLoadError("Unable to reach control server. Retrying...");
      backoff = Math.min(backoff * 2, 5000);
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      retryTimer = window.setTimeout(connectEvents, backoff);
    };

    const connectEvents = () => {
      if (!mounted) return;
      cleanupSocket();
      const ws = subscribeToAgentEvents(
        (agentList) => mounted && setAgents(agentList),
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
      socket = ws;

      ws.onopen = () => {
        backoff = 1000;
        setLoadError(null);
        fetchAgents(API_BASE)
          .then((list) => {
            if (!mounted) return;
            setAgents(list);
          })
          .catch(() => {
            if (!mounted) return;
            scheduleRetry();
          });
      };

      ws.onerror = scheduleRetry;
      ws.onclose = scheduleRetry;
    };

    fetchAgents(API_BASE)
      .then((list) => {
        if (!mounted) return;
        backoff = 1000;
        setAgents(list);
        setLoadError(null);
        connectEvents();
      })
      .catch(() => {
        if (!mounted) return;
        scheduleRetry();
      });

    return () => {
      mounted = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      cleanupSocket();
    };
  }, []);

  const agent = useMemo(() => agents.find((a) => a.id === id), [agents, id]);
  const currentId = agent?.id ?? id ?? "";
  const displayId = agent ? agent.deviceId ?? agent.remoteAgentId ?? agent.id : id ?? "";

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
              <h1 className="text-xl font-semibold tracking-tight">{displayId}</h1>
            </div>
          </div>
          {agent && <AgentStatusDot status={agent.status} />}
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-6 py-6">
        {!agent && !loadError && <p className="text-sm text-muted-foreground">Agent not found.</p>}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {agent && (
          <AgentTerminal
            key={currentId}
            agentId={currentId}
            apiBase={API_BASE}
            connectionId={agent.connectionId}
            enabled={agent.status === "connected" && !loadError}
          />
        )}
      </section>
    </main>
  );
}
