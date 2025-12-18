import fs from "fs";
import { type IncomingMessage, type Server as HttpServer } from "http";
import WebSocket, { type RawData, WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";
import {
  currentAgent,
  listAgents,
  onAgentOutput,
  onAgentStatusChange,
  pushToAgent,
  registerInboundAgent,
} from "./agentRegistry";
import { AUTH_TOKEN } from "./config";
import { type AgentRecord } from "./types";
import { inboundAddress } from "./utils/net";

const uiClients: Map<string, Map<string, WebSocket>> = new Map();
const agentEventClients: Set<WebSocket> = new Set();

function broadcastToUi(agentId: string, payload: { type: string; [key: string]: unknown }) {
  const clients = uiClients.get(agentId);
  if (!clients || clients.size === 0) {
    return;
  }

  const targetSession = typeof payload.sessionId === "string" ? payload.sessionId : undefined;

  if (targetSession) {
    const socket = clients.get(targetSession);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
    return;
  }

  for (const socket of clients.values()) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
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

    const sessions = uiClients.get(agentId) ?? new Map<string, WebSocket>();
    const sessionId = uuid();
    sessions.set(sessionId, socket);
    uiClients.set(agentId, sessions);

    console.log(`[ui terminal] connected for agent ${agentId} (viewers=${sessions.size})`);

    socket.send(
      JSON.stringify({
        type: "status",
        status: entry.record.status,
        fingerprint: entry.record.fingerprint,
        deviceId: entry.record.deviceId ?? entry.record.remoteAgentId,
        remoteAgentId: entry.record.remoteAgentId,
        agentId: entry.record.id,
        connectionId: sessionId,
        sessionId,
      }),
    );

    try {
      pushToAgent(agentId, { type: "reset", sessionId });
    } catch (err) {
      socket.send(JSON.stringify({ type: "error", message: (err as Error).message }));
    }

    socket.on("message", (data: RawData) => {
      try {
        const parsed = JSON.parse(data.toString()) as { type?: string; data?: string };
        if (parsed.type !== "input" || typeof parsed.data !== "string") return;
        pushToAgent(agentId, { type: "keystroke", data: parsed.data, sessionId });
      } catch (err) {
        socket.send(JSON.stringify({ type: "error", message: (err as Error).message }));
      }
    });

    socket.on("close", () => {
      const currentSessions = uiClients.get(agentId);
      if (currentSessions) {
        currentSessions.delete(sessionId);
        if (currentSessions.size === 0) {
          uiClients.delete(agentId);
          console.log(`[ui terminal] disconnected for agent ${agentId} (viewers=0)`);
        } else {
          console.log(`[ui terminal] disconnected for agent ${agentId} (viewers=${currentSessions.size})`);
        }
      }
    });
  });
}

function handleAgentEventStream(agentEventsWss: WebSocketServer) {
  agentEventsWss.on("connection", (socket: WebSocket) => {
    agentEventClients.add(socket);
    socket.send(JSON.stringify({ type: "agents", agents: listAgents() }));

    socket.on("close", () => {
      agentEventClients.delete(socket);
    });
  });
}

function handleInboundAgents(inboundAgentWss: WebSocketServer) {
  inboundAgentWss.on("wsClientError", (err: Error, _socket: WebSocket, req: IncomingMessage) => {
    console.warn(`[agent inbound] wsClientError ${req.url ?? ""}: ${err.message}`);
    try {
      fs.appendFileSync(
        "/tmp/spectre-ws-errors.log",
        `[${new Date().toISOString()}] ${req.url ?? ""} ${err.message}\n`,
      );
    } catch {
      /* ignore file write errors */
    }
  });

  inboundAgentWss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    console.log(`[agent inbound] connection attempt ${req.url ?? ""} from ${inboundAddress(req)}`);
    const { searchParams } = new URL(req.url ?? "", `http://${req.headers.host}`);
    const token = searchParams.get("token") || AUTH_TOKEN;
    if (token !== AUTH_TOKEN) {
      socket.close(4401, "invalid token");
      return;
    }

    const address = inboundAddress(req);
    registerInboundAgent(socket, token, address);
  });
}

function routeUpgrades(httpServer: HttpServer, uiWss: WebSocketServer, agentEventsWss: WebSocketServer, inboundAgentWss: WebSocketServer) {
  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const { pathname } = new URL(req.url ?? "", `http://${req.headers.host}`);
    const key = req.headers["sec-websocket-key"] ? "present" : "missing";
    console.log(
      `[ws upgrade] ${req.method} ${req.url} upgrade=${req.headers.upgrade} version=${req.headers["sec-websocket-version"]} key=${key}`,
    );
    if (pathname === "/terminal") {
      uiWss.handleUpgrade(req, socket, head, (ws) => uiWss.emit("connection", ws, req));
      return;
    }
    if (pathname === "/agents/events") {
      agentEventsWss.handleUpgrade(req, socket, head, (ws) => agentEventsWss.emit("connection", ws, req));
      return;
    }
    if (pathname === "/agents/register") {
      inboundAgentWss.handleUpgrade(req, socket, head, (ws) => inboundAgentWss.emit("connection", ws, req));
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
      deviceId: record.deviceId ?? record.remoteAgentId,
      remoteAgentId: record.remoteAgentId,
      agentId: record.id,
      connectionId: record.connectionId,
    });
    broadcastAgentEvent(record);
  });

  onAgentOutput((agentId, payload) => {
    broadcastToUi(agentId, payload);
  });

  const uiWss = new WebSocketServer({ noServer: true });
  const agentEventsWss = new WebSocketServer({ noServer: true });
  const inboundAgentWss = new WebSocketServer({ noServer: true });

  handleUiConnection(uiWss);
  handleAgentEventStream(agentEventsWss);
  handleInboundAgents(inboundAgentWss);
  routeUpgrades(httpServer, uiWss, agentEventsWss, inboundAgentWss);
}
