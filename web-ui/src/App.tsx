import { useNavigate } from "react-router-dom";
import { Badge } from "./components/ui/badge";
import { AddMachineCard } from "./components/AddMachineCard";
import { ConnectionsCard } from "./components/ConnectionsCard";
import { StatusCounts } from "./components/StatusCounts";
import { ThemeToggle } from "./components/ThemeToggle";
import { VersionFooter } from "./components/VersionFooter";
import { useDashboard } from "./hooks/useDashboard";
import { getApiBase } from "./lib/api";

const API_BASE = getApiBase();

function App() {
  const navigate = useNavigate();
  const {
    dedupedAgents,
    connectedAgents,
    disconnectedAgents,
    pending,
    removingId,
    pendingBusy,
    pendingError,
    handleRemoveAgent,
    handleApprovePending,
    handleRejectPending,
  } = useDashboard(API_BASE);

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

        <AddMachineCard apiBase={API_BASE} />

        <ConnectionsCard
          dedupedAgents={dedupedAgents}
          pending={pending}
          pendingError={pendingError}
          pendingBusy={pendingBusy}
          removingId={removingId}
          onApprovePending={handleApprovePending}
          onRejectPending={handleRejectPending}
          onOpenAgent={(agent) => navigate(`/agent/${agent.id}`)}
          onRemoveAgent={handleRemoveAgent}
        />

        <StatusCounts connectedCount={connectedAgents.length} disconnectedCount={disconnectedAgents.length} />
      </section>
      <VersionFooter apiBase={API_BASE} />
    </main>
  );
}

export default App;
