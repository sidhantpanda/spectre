import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Props = {
  agentId: string;
  apiBase?: string;
  connected: boolean;
  connectionId?: string;
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

export function AgentTerminal({ agentId, apiBase, connected, connectionId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [sessionId, setSessionId] = useState(connectionId ?? "");

  useEffect(() => {
    if (!connected) {
      setStatus("disconnected");
      return;
    }

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
    const node = containerRef.current;
    if (node) {
      term.open(node);
      fit.fit();
    }

    if (connectionId) {
      setSessionId(connectionId);
    }

    const socket = new WebSocket(buildSocketUrl(apiBase, agentId));
    socketRef.current = socket;
    setStatus("connecting");

    const handleResize = () => {
      fit.fit();
    };
    window.addEventListener("resize", handleResize);

    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    socket.onopen = () => {
      setStatus("connected");
      term.writeln("\x1b[32mConnected to agent terminal\x1b[0m");
      fit.fit();
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

    socket.onclose = () => {
      setStatus("disconnected");
      term.writeln("\r\n[disconnected]");
    };

    socket.onerror = () => {
      setStatus("error");
      term.writeln("\r\n[error] Unable to reach terminal backend");
    };

    return () => {
      window.removeEventListener("resize", handleResize);
      socket.close();
      term.dispose();
      socketRef.current = null;
    };
  }, [agentId, apiBase, connected, connectionId]);

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
