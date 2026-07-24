import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { buildWsUrl } from "../lib/api";
import { SessionPicker, type SessionInfo } from "./SessionPicker";
import { SessionExitDialog } from "./SessionExitDialog";
import { Button } from "./ui/button";

type Props = {
  agentId: string;
  apiBase?: string;
  connectionId?: string;
  enabled?: boolean;
  /** Called when the user chooses to leave the host (kill or leave running). */
  onLeaveHost?: () => void;
};

type TerminalMessage =
  | { type: "output"; data: string; sessionId?: string }
  | { type: "status"; status: string; connectionId?: string }
  | { type: "sessions"; sessions?: SessionInfo[]; tmuxAvailable?: boolean }
  | { type: "attached"; sessionId: string }
  | { type: "sessionExited"; sessionId: string }
  | { type: "sessionClosed"; sessionId: string }
  | { type: "error"; message: string };

/** End-of-transmission — what Ctrl+D sends. */
const CTRL_D = "\x04";

export function AgentTerminal({ agentId, apiBase, connectionId, enabled = true, onLeaveHost }: Props) {
  const socketRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  // Output can arrive between attaching and the terminal being mounted; hold it
  // rather than dropping the first lines of the session.
  const pendingOutput = useRef<string[]>([]);
  const activeSessionRef = useRef<string | null>(null);

  const [termNode, setTermNode] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tmuxAvailable, setTmuxAvailable] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const send = useCallback((payload: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const setActive = useCallback((sessionId: string | null) => {
    activeSessionRef.current = sessionId;
    setActiveSessionId(sessionId);
  }, []);

  // Create the terminal only while a session is attached, so the picker is not
  // sitting behind a stale, zero-sized xterm instance.
  useEffect(() => {
    if (!activeSessionId || !termNode) return;

    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: "#0B1021",
        foreground: "#E2E8F0",
        black: "#1e293b",
        green: "#22c55e",
        cyan: "#06b6d4",
        blue: "#3b82f6",
        magenta: "#a855f7",
        red: "#ef4444",
        yellow: "#eab308",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termNode);
    termRef.current = term;
    fitRef.current = fit;

    const safeFit = () => {
      if (!fitRef.current || !termRef.current?.element) return;
      try {
        fitRef.current.fit();
      } catch {
        // ignore transient sizing errors
      }
    };

    // Fitting only resizes the canvas in the browser. The remote PTY has to be
    // told separately, or the shell keeps wrapping lines and drawing
    // full-screen programs for its original geometry.
    const resizeHandler = term.onResize(({ cols, rows }) => {
      send({ type: "resize", cols, rows });
    });

    safeFit();
    // onResize only fires when the fitted size differs from xterm's default, so
    // send the current geometry unconditionally — the session may have been
    // left at a different size by a previous viewer.
    send({ type: "resize", cols: term.cols, rows: term.rows });

    for (const chunk of pendingOutput.current) term.write(chunk);
    pendingOutput.current = [];

    // Ctrl+D is swallowed here, before it can reach the agent. The shell never
    // sees it, so nothing has exited yet and the dialog can still offer to keep
    // the session running.
    const dataHandler = term.onData((data) => {
      if (data === CTRL_D) {
        setExitPromptOpen(true);
        return;
      }
      send({ type: "input", data });
    });

    // A ResizeObserver catches everything a window listener misses: the sidebar
    // opening, the notice banner appearing, a phone rotating, the container's
    // own vh-based height changing.
    const observer = new ResizeObserver(() => safeFit());
    observer.observe(termNode);
    window.addEventListener("resize", safeFit);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", safeFit);
      resizeHandler.dispose();
      dataHandler.dispose();
      fitRef.current?.dispose();
      fitRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [activeSessionId, termNode, send]);

  const writeToTerm = useCallback((data: string) => {
    const term = termRef.current;
    if (term?.element) term.write(data);
    else pendingOutput.current.push(data);
  }, []);

  // Socket lifecycle, independent of which session is attached: the picker and
  // the terminal share one connection.
  useEffect(() => {
    let cancelled = false;
    let backoff = 1000;

    const cleanupSocket = () => {
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.onmessage = null;
        socketRef.current.onopen = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };

    if (!enabled) {
      setStatus("disconnected");
      cleanupSocket();
      return () => {};
    }

    const connect = async () => {
      if (cancelled) return;
      setStatus("connecting");

      // Each attempt mints a fresh single-use ticket; a reconnect cannot reuse
      // the previous one.
      let url: string;
      try {
        url = await buildWsUrl(`/terminal?id=${encodeURIComponent(agentId)}`, apiBase);
      } catch {
        setStatus("error");
        setNotice("Could not authenticate terminal session.");
        return;
      }
      if (cancelled) return;

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        backoff = 1000;
        setStatus("connected");
        setNotice(null);
        // Re-attach after a dropped link so the session survives the round trip.
        // The terminal already exists here, so its geometry rides along and the
        // re-opened PTY starts at the right size.
        if (activeSessionRef.current) {
          const term = termRef.current;
          send({
            type: "attach",
            sessionId: activeSessionRef.current,
            ...(term ? { cols: term.cols, rows: term.rows } : {}),
          });
        }
      };

      socket.onmessage = (evt) => {
        let payload: TerminalMessage;
        try {
          payload = JSON.parse(evt.data) as TerminalMessage;
        } catch {
          return;
        }

        switch (payload.type) {
          case "output":
            writeToTerm(payload.data);
            return;
          case "sessions": {
            const list = payload.sessions ?? [];
            setSessions(list);
            setTmuxAvailable(payload.tmuxAvailable ?? false);
            // Nothing running on the host: open one straight away rather than
            // showing an empty picker.
            if (!activeSessionRef.current && list.length === 0) {
              send({ type: "create" });
            }
            return;
          }
          case "attached":
            pendingOutput.current = [];
            setActive(payload.sessionId);
            setNotice(null);
            return;
          case "sessionExited":
            // The shell ended on its own (an `exit`, or the process died).
            if (activeSessionRef.current === payload.sessionId) {
              setActive(null);
              setNotice("The shell in that session exited.");
            }
            send({ type: "listSessions" });
            return;
          case "sessionClosed":
            if (activeSessionRef.current === payload.sessionId) setActive(null);
            return;
          case "status":
            if (payload.status === "connected") setStatus("connected");
            else if (payload.status === "connecting") setStatus("connecting");
            else {
              setStatus("disconnected");
              setNotice("The agent disconnected.");
            }
            return;
          case "error":
            setNotice(payload.message);
            return;
        }
      };

      const scheduleReconnect = () => {
        if (cancelled) return;
        if (socketRef.current === socket) socketRef.current = null;
        setStatus("disconnected");
        backoff = Math.min(backoff * 2, 5000);
        reconnectTimer.current = window.setTimeout(() => void connect(), backoff);
      };

      socket.onclose = scheduleReconnect;
      socket.onerror = () => {
        setStatus("error");
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      cleanupSocket();
    };
  }, [agentId, apiBase, connectionId, enabled, send, setActive, writeToTerm]);

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
    [leaveHost, send],
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
          onAttach={(sessionId) => send({ type: "attach", sessionId })}
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
