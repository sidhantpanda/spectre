import { type IncomingMessage } from "http";
import WebSocket, { type RawData, WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";
import { currentAgent, pushToAgent } from "../agentRegistry";
import { type ControlMessage } from "../types";
import { MAX_UI_MESSAGE_BYTES, uiClients, type Viewer } from "./clients";

export function handleUiConnection(uiWss: WebSocketServer) {
  uiWss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const { searchParams } = new URL(req.url ?? "", `http://${req.headers.host}`);
    const agentId = searchParams.get("id");
    if (!agentId) {
      socket.close(1008, "missing agent id");
      return;
    }

    const entry = currentAgent(agentId);
    if (!entry) {
      socket.close(4404, "agent not found");
      return;
    }

    const viewerId = uuid();
    const viewer: Viewer = { socket, sessionId: null };

    const viewers = uiClients.get(agentId) ?? new Map<string, Viewer>();
    viewers.set(viewerId, viewer);
    uiClients.set(agentId, viewers);

    console.log(`[ui terminal] viewer connected for agent ${agentId} (viewers=${viewers.size})`);

    const send = (payload: Record<string, unknown>) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    const toAgent = (message: ControlMessage) => {
      try {
        pushToAgent(agentId, message);
        return true;
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
        return false;
      }
    };

    send({
      type: "status",
      status: entry.record.status,
      fingerprint: entry.record.fingerprint,
      deviceId: entry.record.deviceId,
      agentId: entry.record.id,
      connectionId: viewerId,
    });

    // No session is opened on connect. The tab lands on the picker and the user
    // chooses, so merely opening a terminal page no longer spawns a shell on
    // the host.
    toAgent({ type: "listSessions" });

    socket.on("message", (data: RawData) => {
      const raw = data.toString();
      if (raw.length > MAX_UI_MESSAGE_BYTES) {
        socket.close(1009, "message too large");
        return;
      }

      let parsed: { type?: string; data?: string; sessionId?: string; cols?: number; rows?: number };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
        return;
      }

      // Geometry is only ever forwarded when it is a sane pair of positive
      // integers, so a bad client cannot push the remote PTY to 0 or absurd
      // sizes.
      const geometry = () => {
        const { cols, rows } = parsed;
        if (!Number.isInteger(cols) || !Number.isInteger(rows)) return undefined;
        if (cols! < 1 || rows! < 1 || cols! > 1000 || rows! > 1000) return undefined;
        return { cols: cols!, rows: rows! };
      };

      switch (parsed.type) {
        case "input": {
          if (typeof parsed.data !== "string") return;
          // Keystrokes before a session is chosen have nowhere to go; dropping
          // them stops a stray keypress from being written into whichever
          // session happened to be first.
          if (!viewer.sessionId) return;
          toAgent({ type: "keystroke", data: parsed.data, sessionId: viewer.sessionId });
          return;
        }
        case "listSessions":
          toAgent({ type: "listSessions" });
          return;
        case "create": {
          const sessionId = `spectre-${uuid()}`;
          viewer.sessionId = sessionId;
          if (toAgent({ type: "createSession", sessionId, ...geometry() })) {
            send({ type: "attached", sessionId });
          }
          return;
        }
        case "attach": {
          if (typeof parsed.sessionId !== "string" || !parsed.sessionId) return;
          viewer.sessionId = parsed.sessionId;
          if (toAgent({ type: "attachSession", sessionId: parsed.sessionId, ...geometry() })) {
            send({ type: "attached", sessionId: parsed.sessionId });
          }
          return;
        }
        case "resize": {
          const size = geometry();
          if (!size || !viewer.sessionId) return;
          toAgent({ type: "resize", sessionId: viewer.sessionId, ...size });
          return;
        }
        case "kill": {
          if (typeof parsed.sessionId !== "string" || !parsed.sessionId) return;
          if (viewer.sessionId === parsed.sessionId) viewer.sessionId = null;
          toAgent({ type: "killSession", sessionId: parsed.sessionId });
          return;
        }
        // Leaving a session running: unbind this tab without touching the
        // session, so it stays attachable later.
        case "detach":
          viewer.sessionId = null;
          toAgent({ type: "listSessions" });
          return;
      }
    });

    // Closing the tab leaves the session running on the host; that is the whole
    // point of tmux-backed sessions, and it is what makes "go back without
    // killing it" work.
    socket.on("close", () => {
      const currentViewers = uiClients.get(agentId);
      if (!currentViewers) return;
      currentViewers.delete(viewerId);
      if (currentViewers.size === 0) uiClients.delete(agentId);
      console.log(`[ui terminal] viewer disconnected for agent ${agentId} (viewers=${currentViewers.size})`);
    });
  });
}
