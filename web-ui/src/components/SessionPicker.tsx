import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

/** One attachable session on the agent's host. Mirrors the server's SessionInfo. */
export type SessionInfo = {
  id: string;
  createdAt?: number;
  attached: boolean;
  windows?: number;
  /** True for sessions Spectre created, false for ones started outside it. */
  managed: boolean;
  /** True when the agent currently holds a PTY for it. */
  live: boolean;
};

type Props = {
  sessions: SessionInfo[];
  tmuxAvailable: boolean;
  busy?: boolean;
  onAttach: (sessionId: string) => void;
  onCreate: () => void;
  onKill: (sessionId: string) => void;
};

/** Trims the uuid on Spectre-created names so the list stays readable. */
function displayName(session: SessionInfo) {
  if (!session.managed) return session.id;
  const suffix = session.id.replace(/^spectre-/, "");
  return suffix.length > 8 ? `spectre-${suffix.slice(0, 8)}` : session.id;
}

function age(createdAt?: number) {
  if (!createdAt) return null;
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - createdAt));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SessionPicker({ sessions, tmuxAvailable, busy, onAttach, onCreate, onKill }: Props) {
  const sorted = [...sessions].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return (
    <div className="flex flex-col gap-4 rounded-md border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Sessions</h2>
          <p className="text-sm text-muted-foreground">
            {sorted.length === 0
              ? "No sessions running on this host."
              : "Pick a session to attach to, or start a new one."}
          </p>
        </div>
        <Button size="sm" onClick={onCreate} disabled={busy}>
          New session
        </Button>
      </div>

      {!tmuxAvailable && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          tmux is not installed on this host, so sessions end when you disconnect. Install tmux to keep them running.
        </p>
      )}

      {sorted.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {sorted.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left disabled:opacity-50"
                onClick={() => onAttach(session.id)}
                disabled={busy}
              >
                <span className="flex items-center gap-2">
                  <code className="truncate text-sm font-medium">{displayName(session)}</code>
                  {!session.managed && (
                    <Badge variant="outline" title="Started outside Spectre">
                      external
                    </Badge>
                  )}
                  {session.attached && <Badge variant="secondary">attached</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[age(session.createdAt), session.windows ? `${session.windows} window${session.windows === 1 ? "" : "s"}` : null]
                    .filter(Boolean)
                    .join(" · ") || "in memory only"}
                </span>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onKill(session.id)}
                disabled={busy}
                aria-label={`Kill session ${session.id}`}
              >
                Kill
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
