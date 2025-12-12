import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Props = {
  agentId: string;
  apiBase?: string;
  connectionId?: string;
  enabled?: boolean;
};

type TerminalMessage =
  | { type: "output"; data: string }
  | { type: "status"; status: string; connectionId?: string }
  | { type: "error"; message: string };

function buildSocketUrl(apiBase: string | undefined, agentId: string) {
  const base = apiBase && apiBase.length > 0 ? apiBase : window.location.origin;
  const url = new URL("/terminal", base);
  url.protocol = url.protocol.replace("http", "ws");
  url.searchParams.set("id", agentId);
  return url.toString();
}

export function AgentTerminal({ agentId, apiBase, connectionId, enabled = true }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [sessionId, setSessionId] = useState(connectionId ?? "");

  // Initialize the terminal once.
  useEffect(() => {
    if (termRef.current) return;
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
    termRef.current = term;
    fitRef.current = fit;

    const node = containerRef.current;
    if (node) {
      term.open(node);
      fit.fit();
    }

    const handleResize = () => {
      fitRef.current?.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, []);

  // Register input handler once per agentId change.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const handler = term.onData((data) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });
    return () => handler.dispose();
  }, [agentId]);

  // Manage socket lifecycle with reconnection/backoff.
  useEffect(() => {
    if (connectionId) setSessionId(connectionId);
    const term = termRef.current;
    if (!term) return;

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

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      const socket = new WebSocket(buildSocketUrl(apiBase, agentId));
      socketRef.current = socket;

      term.writeln(`\r\n[connecting] ${agentId}`);

      socket.onopen = () => {
        backoff = 1000;
        setStatus("connected");
        term.writeln("\x1b[32mConnected to agent terminal\x1b[0m");
        fitRef.current?.fit();
      };

      socket.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data) as TerminalMessage;
          if (payload.type === "output") {
            term.write(payload.data);
          } else if (payload.type === "status") {
            if (payload.status === "connected") {
              setStatus("connected");
              if (payload.connectionId) {
                setSessionId(payload.connectionId);
              }
            } else if (payload.status === "connecting") {
              setStatus("connecting");
            } else {
              setStatus("disconnected");
            }
            term.writeln(`\r\n[agent status] ${payload.status}`);
          } else if (payload.type === "error") {
            term.writeln(`\r\n[error] ${payload.message}`);
            setStatus("error");
          }
        } catch {
          term.write(evt.data);
        }
      };

      const scheduleReconnect = () => {
        if (cancelled) return;
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setStatus("disconnected");
        term.writeln("\r\n[disconnected] retrying...");
        backoff = Math.min(backoff * 2, 5000);
        reconnectTimer.current = window.setTimeout(connect, backoff);
      };

      socket.onclose = scheduleReconnect;
      socket.onerror = () => {
        setStatus("error");
        term.writeln("\r\n[error] Unable to reach terminal backend");
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      cleanupSocket();
    };
  }, [agentId, apiBase, connectionId, enabled]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Terminal</span>
        <span className="flex items-center gap-2">
          {sessionId && <code className="rounded bg-muted px-2 py-0.5 text-[11px]">session: {sessionId}</code>}
          <span>{status}</span>
        </span>
      </div>
      <div
        ref={containerRef}
        className="h-64 w-full overflow-hidden rounded-md border bg-black/80"
        data-testid={`terminal-${agentId}`}
      />
    </div>
  );
}
