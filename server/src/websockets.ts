import { type IncomingMessage, type Server as HttpServer } from "http";
import WebSocket, { type RawData, WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";
import { currentAgent, listAgents, onAgentOutput, onAgentStatusChange, pushToAgent, registerInboundAgent } from "./agentRegistry";
import { extractTicketFromUrl, isAuthEnabled, redeemWsTicket } from "./auth";
import { findDeviceByKey, isInitialized as isDeviceStoreInitialized, redeemAuthKey, touchDevice } from "./deviceStore";
import { type AgentRecord, type ControlMessage } from "./types";
import { inboundAddress, safePath } from "./utils/net";

/**
 * A connected browser tab, and the session it is currently attached to.
 *
 * `sessionId` is null while the tab is sitting on the session picker, and is
 * bound the moment it attaches to or creates one.
 */
type Viewer = { socket: WebSocket; sessionId: string | null };

const uiClients: Map<string, Map<string, Viewer>> = new Map();
const agentEventClients: Set<WebSocket> = new Set();

// Keystrokes are small; a peer sending more than this is not a terminal user.
const MAX_UI_MESSAGE_BYTES = 64 * 1024;

/**
 * Payloads that belong to one session and must not leak into another tab.
 *
 * Everything else (status, session lists) is agent-wide and goes to every
 * viewer of that agent.
 */
const SESSION_SCOPED = new Set(["output", "sessionExited"]);

function broadcastToUi(agentId: string, payload: { type: string; [key: string]: unknown }) {
  const clients = uiClients.get(agentId);
  if (!clients || clients.size === 0) return;

  const targetSession = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
  const raw = JSON.stringify(payload);

  // Terminal output is addressed by session, and viewers are keyed by viewer
  // id, so this has to match on the viewer's bound session rather than looking
  // the id up as a key. Getting this wrong sends one session's output to every
  // tab watching the agent — which, with a single hardcoded session, used to
  // look harmless.
  if (targetSession && SESSION_SCOPED.has(payload.type)) {
    for (const viewer of clients.values()) {
      if (viewer.sessionId !== targetSession) continue;
      if (viewer.socket.readyState === WebSocket.OPEN) viewer.socket.send(raw);
    }
    return;
  }

  for (const viewer of clients.values()) {
    if (viewer.socket.readyState === WebSocket.OPEN) viewer.socket.send(raw);
  }
}

function broadcastAgentEvent(record: AgentRecord) {
  for (const socket of agentEventClients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "agent", agent: record }));
    }
  }
}

function handleUiConnection(uiWss: WebSocketServer) {
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

      let parsed: { type?: string; data?: string; sessionId?: string };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
        return;
      }

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
          if (toAgent({ type: "createSession", sessionId })) {
            send({ type: "attached", sessionId });
          }
          return;
        }
        case "attach": {
          if (typeof parsed.sessionId !== "string" || !parsed.sessionId) return;
          viewer.sessionId = parsed.sessionId;
          if (toAgent({ type: "attachSession", sessionId: parsed.sessionId })) {
            send({ type: "attached", sessionId: parsed.sessionId });
          }
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

function handleAgentEventStream(agentEventsWss: WebSocketServer) {
  agentEventsWss.on("connection", (socket: WebSocket) => {
    agentEventClients.add(socket);
    socket.send(JSON.stringify({ type: "agents", agents: listAgents() }));
    socket.on("close", () => agentEventClients.delete(socket));
  });
}

/**
 * Reads the agent's credential from the Authorization header.
 *
 * Credentials are never accepted in the query string: URLs end up in access
 * logs, proxy logs and Referer headers, and a device key is a permanent shell
 * credential.
 */
function agentCredential(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const value = header.slice(7).trim();
  return value.length > 0 ? value : null;
}

type AgentAuth = { deviceStoreId: string; issuedDeviceKey?: string };

/**
 * Authenticates an agent from its handshake request.
 *
 * Runs before the WebSocket handshake is completed, so an unauthenticated peer
 * never gets an open socket. Returns null to reject.
 */
function authenticateAgent(req: IncomingMessage): AgentAuth | null {
  const address = inboundAddress(req);

  if (!isDeviceStoreInitialized()) return null;

  const credential = agentCredential(req);
  if (!credential) {
    console.log(`[agent] rejected connection from ${address}: no credential`);
    return null;
  }

  // An auth key enrols the machine and is exchanged for a device key on the
  // spot, so a fresh agent is connected in one round trip.
  if (credential.startsWith("sk_")) {
    const enrolled = redeemAuthKey(credential);
    if (!enrolled) {
      console.log(`[agent] rejected connection from ${address}: invalid or spent auth key`);
      return null;
    }
    console.log(`[agent] enrolled new device ${enrolled.device.id} from ${address}`);
    return { deviceStoreId: enrolled.device.id, issuedDeviceKey: enrolled.deviceKey };
  }

  const device = findDeviceByKey(credential);
  if (!device) {
    console.log(`[agent] rejected connection from ${address}: unknown or revoked device key`);
    return null;
  }
  touchDevice(credential, { lastSeen: Date.now() });
  console.log(`[agent] device ${device.id} connected from ${address}`);
  return { deviceStoreId: device.id };
}

function handleInboundAgents(inboundAgentWss: WebSocketServer) {
  inboundAgentWss.on("connection", (socket: WebSocket, req: IncomingMessage, auth: AgentAuth) => {
    registerInboundAgent(socket, inboundAddress(req), auth.deviceStoreId);
    if (auth.issuedDeviceKey) {
      socket.send(JSON.stringify({ type: "enrolled", deviceKey: auth.issuedDeviceKey } satisfies ControlMessage));
    }
  });
}

function checkUiAuth(req: IncomingMessage): boolean {
  if (!isAuthEnabled()) return true;
  return redeemWsTicket(extractTicketFromUrl(req.url ?? "", req.headers.host ?? "localhost"));
}

function routeUpgrades(
  httpServer: HttpServer,
  uiWss: WebSocketServer,
  agentEventsWss: WebSocketServer,
  inboundAgentWss: WebSocketServer,
) {
  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const { pathname } = new URL(req.url ?? "", `http://${req.headers.host}`);
    // safePath, not req.url: the terminal URL carries a ticket.
    console.log(`[ws upgrade] ${safePath(req.url)}`);

    if (pathname === "/terminal" || pathname === "/agents/events") {
      if (!checkUiAuth(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const wss = pathname === "/terminal" ? uiWss : agentEventsWss;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return;
    }

    if (pathname === "/agents/register") {
      const auth = authenticateAgent(req);
      if (!auth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      inboundAgentWss.handleUpgrade(req, socket, head, (ws) =>
        inboundAgentWss.emit("connection", ws, req, auth),
      );
      return;
    }

    socket.destroy();
  });
}

export function attachWebSockets(httpServer: HttpServer) {
  onAgentStatusChange((record) => {
    broadcastToUi(record.id, {
      type: "status",
      status: record.status,
      fingerprint: record.fingerprint,
      deviceId: record.deviceId,
      agentId: record.id,
      connectionId: record.connectionId,
    });
    broadcastAgentEvent(record);
  });

  onAgentOutput((agentId, payload) => broadcastToUi(agentId, payload));

  const uiWss = new WebSocketServer({ noServer: true, maxPayload: MAX_UI_MESSAGE_BYTES });
  const agentEventsWss = new WebSocketServer({ noServer: true, maxPayload: MAX_UI_MESSAGE_BYTES });
  const inboundAgentWss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  handleUiConnection(uiWss);
  handleAgentEventStream(agentEventsWss);
  handleInboundAgents(inboundAgentWss);
  routeUpgrades(httpServer, uiWss, agentEventsWss, inboundAgentWss);
}
