import { useCallback, useEffect, useRef, useState } from "react";
import { buildWsUrl } from "../lib/api";
import { type SessionInfo } from "../components/SessionPicker";
import { type TerminalMessage } from "../components/terminal/types";

export type TerminalStatus = "disconnected" | "connecting" | "connected" | "error";

type UseTerminalSocketParams = {
  agentId: string;
  apiBase?: string;
  connectionId?: string;
  enabled: boolean;
  /** The route-driven session id and its setter; mirrors the AgentTerminal props. */
  routeSessionId: string | null;
  onSessionChange?: (sessionId: string | null) => void;
  writeToTerm: (data: string) => void;
  /** Drops any output buffered for a session that is being left behind. */
  clearPendingOutput: () => void;
  /** The live terminal's geometry, if one is mounted — used to size a re-attach. */
  getTermSize: () => { cols: number; rows: number } | undefined;
};

/**
 * Socket lifecycle: ticket → connect → reconnect backoff, the onmessage
 * switch, and `send`. Independent of which session is attached: the picker
 * and the terminal share this one connection.
 */
export function useTerminalSocket({
  agentId,
  apiBase,
  connectionId,
  enabled,
  routeSessionId,
  onSessionChange,
  writeToTerm,
  clearPendingOutput,
  getTermSize,
}: UseTerminalSocketParams) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  // The route drives which session is attached; kept in a ref so the socket
  // handlers can read it without being torn down on every navigation.
  const routeSessionRef = useRef<string | null>(routeSessionId);
  routeSessionRef.current = routeSessionId;
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;
  // The last route value acted on. A navigation lands a render later than the
  // state change that triggered it, so without this the terminal would see its
  // own not-yet-applied navigation as the user asking for something else.
  const handledRouteRef = useRef<string | null | undefined>(undefined);

  const [status, setStatus] = useState<TerminalStatus>("disconnected");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [tmuxAvailable, setTmuxAvailable] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const send = useCallback((payload: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const setActive = useCallback((sessionId: string | null) => {
    activeSessionRef.current = sessionId;
    setActiveSessionId(sessionId);
    if (routeSessionRef.current !== sessionId) onSessionChangeRef.current?.(sessionId);
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
          const size = getTermSize();
          send({
            type: "attach",
            sessionId: activeSessionRef.current,
            ...(size ?? {}),
          });
        } else {
          // An attach the dropped socket never answered is still owed to the
          // route; let the sync effect issue it again.
          handledRouteRef.current = undefined;
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
            setSessionsLoaded(true);
            setTmuxAvailable(payload.tmuxAvailable ?? false);
            // Nothing running on the host: open one straight away rather than
            // showing an empty picker. A route that names a session is left to
            // the sync effect below, which reports a dead link instead.
            if (!activeSessionRef.current && !routeSessionRef.current && list.length === 0) {
              send({ type: "create" });
            }
            return;
          }
          case "attached":
            clearPendingOutput();
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
  }, [agentId, apiBase, connectionId, enabled, send, setActive, writeToTerm, clearPendingOutput]);

  return {
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
  };
}
