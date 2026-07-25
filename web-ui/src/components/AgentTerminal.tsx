import { useCallback, useEffect, useRef, useState } from "react";
import { type Terminal } from "@xterm/xterm";
import { CTRL_D } from "./terminal/types";
import { useTerminalSocket } from "../hooks/useTerminalSocket";
import { useXterm } from "../hooks/useXterm";
import { SessionPicker } from "./SessionPicker";
import { SessionExitDialog } from "./SessionExitDialog";
import { Button } from "./ui/button";

type Props = {
  agentId: string;
  apiBase?: string;
  connectionId?: string;
  enabled?: boolean;
  /** Session to attach to, taken from the route. null shows the picker. */
  sessionId?: string | null;
  /** Reports the session the terminal moved to, so the route can follow it. */
  onSessionChange?: (sessionId: string | null) => void;
  /** Called when the user chooses to leave the host (kill or leave running). */
  onLeaveHost?: () => void;
};

export function AgentTerminal({
  agentId,
  apiBase,
  connectionId,
  enabled = true,
  sessionId: routeSessionId = null,
  onSessionChange,
  onLeaveHost,
}: Props) {
  const [exitPromptOpen, setExitPromptOpen] = useState(false);

  // termRef and pendingOutput are shared by both hooks below: useTerminalSocket
  // writes into the terminal (or buffers, if it is not mounted yet) and reports
  // the live geometry, while useXterm owns the actual xterm.js instance. They
  // are declared here, not inside either hook, because useTerminalSocket is
  // wired up before useXterm runs and needs them from the start.
  const termRef = useRef<Terminal | null>(null);
  const pendingOutput = useRef<string[]>([]);

  // Output can arrive between attaching and the terminal being mounted; hold it
  // rather than dropping the first lines of the session.
  const writeToTerm = useCallback((data: string) => {
    const term = termRef.current;
    if (term?.element) term.write(data);
    else pendingOutput.current.push(data);
  }, []);

  const clearPendingOutput = useCallback(() => {
    pendingOutput.current = [];
  }, []);

  const getTermSize = useCallback(() => {
    const term = termRef.current;
    return term ? { cols: term.cols, rows: term.rows } : undefined;
  }, []);

  const {
    status,
    sessions,
    sessionsLoaded,
    tmuxAvailable,
    activeSessionId,
    notice,
    setNotice,
    send,
    setActive,
    activeSessionRef,
    handledRouteRef,
    onSessionChangeRef,
  } = useTerminalSocket({
    agentId,
    apiBase,
    connectionId,
    enabled,
    routeSessionId,
    onSessionChange,
    writeToTerm,
    clearPendingOutput,
    getTermSize,
  });

  const { termNode, setTermNode } = useXterm({
    activeSessionId,
    termRef,
    pendingOutput,
    exitPromptOpen,
    send,
    onCtrlD: () => setExitPromptOpen(true),
  });

  // Picking a session only moves the route; the effect below does the attaching
  // so every entry point (click, link, reload) takes the same path.
  const requestSession = useCallback(
    (sessionId: string) => {
      if (onSessionChangeRef.current) onSessionChangeRef.current(sessionId);
      else send({ type: "attach", sessionId });
    },
    [send, onSessionChangeRef],
  );

  // Follow the route: a link, a reload, or the Back button all end up here, and
  // this is the only place an attach/detach is issued for them. Only a *move* of
  // the route acts; the terminal reporting where it already is must not, or
  // leaving a session would immediately re-attach to it.
  useEffect(() => {
    if (status !== "connected") return;
    if (handledRouteRef.current === routeSessionId) return;

    if (routeSessionId === activeSessionId) {
      handledRouteRef.current = routeSessionId;
      return;
    }

    if (!routeSessionId) {
      handledRouteRef.current = routeSessionId;
      send({ type: "detach" });
      setActive(null);
      return;
    }

    // Attach only to a session the host actually reports, so a stale link
    // cannot silently spawn a fresh shell under a dead session's name. Left
    // unhandled until the list arrives, so it is retried then.
    if (!sessionsLoaded) return;
    handledRouteRef.current = routeSessionId;

    if (!sessions.some((session) => session.id === routeSessionId)) {
      setNotice("That session is no longer running on this host.");
      setActive(null);
      return;
    }

    const term = termRef.current;
    send({
      type: "attach",
      sessionId: routeSessionId,
      ...(term ? { cols: term.cols, rows: term.rows } : {}),
    });
  }, [activeSessionId, routeSessionId, send, sessions, sessionsLoaded, setActive, status]);

  const leaveHost = useCallback(() => {
    setExitPromptOpen(false);
    setActive(null);
    onLeaveHost?.();
  }, [onLeaveHost, setActive]);

  const handleKill = useCallback(
    (sessionId: string) => {
      send({ type: "kill", sessionId });
      if (activeSessionRef.current === sessionId) leaveHost();
    },
    [leaveHost, send, activeSessionRef],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {activeSessionId ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  send({ type: "detach" });
                  setActive(null);
                }}
              >
                ← Sessions
              </Button>
              <code className="rounded bg-muted px-2 py-0.5 text-[11px]">{activeSessionId}</code>
            </>
          ) : (
            <span>Terminal</span>
          )}
        </span>
        <span>{status}</span>
      </div>

      {notice && <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{notice}</p>}

      {activeSessionId ? (
        <div
          ref={setTermNode}
          className="h-[70vh] min-h-[24rem] w-full overflow-hidden rounded-md border bg-black/80"
          data-testid={`terminal-${agentId}`}
        />
      ) : (
        <SessionPicker
          sessions={sessions}
          tmuxAvailable={tmuxAvailable}
          busy={status !== "connected"}
          onAttach={requestSession}
          onCreate={() => send({ type: "create" })}
          onKill={handleKill}
        />
      )}

      {exitPromptOpen && activeSessionId && (
        <SessionExitDialog
          sessionId={activeSessionId}
          persistent={tmuxAvailable}
          onKill={() => handleKill(activeSessionId)}
          onLeave={() => {
            send({ type: "detach" });
            leaveHost();
          }}
          onSendEof={() => {
            setExitPromptOpen(false);
            send({ type: "input", data: CTRL_D });
          }}
          onDismiss={() => setExitPromptOpen(false)}
        />
      )}
    </div>
  );
}
