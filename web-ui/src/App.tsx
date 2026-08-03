import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "./components/ui/badge";
import { AddMachineCard } from "./components/AddMachineCard";
import { AgentSortMenu } from "./components/AgentSortMenu";
import { ConnectionsCard } from "./components/ConnectionsCard";
import { StatusCounts } from "./components/StatusCounts";
import { ThemeToggle } from "./components/ThemeToggle";
import { VersionFooter } from "./components/VersionFooter";
import { useAgentSort } from "./hooks/useAgentSort";
import { useDashboard } from "./hooks/useDashboard";
import { getApiBase } from "./lib/api";
import { sortAgents } from "./state/agents";

const API_BASE = getApiBase();

function App() {
  const navigate = useNavigate();
  const {
    dedupedAgents,
    connectedAgents,
    disconnectedAgents,
    pending,
    removingId,
    updating,
    updateErrors,
    pendingBusy,
    pendingError,
    handleUpdateAgent,
    handleRemoveAgent,
    handleApprovePending,
    handleRejectPending,
  } = useDashboard(API_BASE);

  const [sort, setSort] = useAgentSort();
  const sortedAgents = useMemo(() => sortAgents(dedupedAgents, sort), [dedupedAgents, sort]);

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

        <AddMachineCard apiBase={API_BASE} />

        {/* Sits above the card, not inside it: the card header is copy about
            what connections are, and the control belongs to the list. */}
        <div className="space-y-2">
          <div className="flex justify-end">
            <AgentSortMenu value={sort} onChange={setSort} />
          </div>

          <ConnectionsCard
            dedupedAgents={sortedAgents}
            pending={pending}
            pendingError={pendingError}
            pendingBusy={pendingBusy}
            removingId={removingId}
            updating={updating}
            updateErrors={updateErrors}
            onApprovePending={handleApprovePending}
            onRejectPending={handleRejectPending}
            onOpenAgent={(agent) => navigate(`/agent/${agent.id}`)}
            onRemoveAgent={handleRemoveAgent}
            onUpdateAgent={handleUpdateAgent}
          />
        </div>

        <StatusCounts connectedCount={connectedAgents.length} disconnectedCount={disconnectedAgents.length} />
      </section>
      <VersionFooter apiBase={API_BASE} />
    </main>
  );
}

export default App;
