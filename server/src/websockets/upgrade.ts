import { type IncomingMessage, type Server as HttpServer } from "http";
import { type WebSocketServer } from "ws";
import { extractTicketFromUrl, isAuthEnabled, redeemWsTicket } from "../auth";
import { safePath } from "../utils/net";
import { authenticateAgent } from "./agentSocket";

export function checkUiAuth(req: IncomingMessage): boolean {
  if (!isAuthEnabled()) return true;
  return redeemWsTicket(extractTicketFromUrl(req.url ?? "", req.headers.host ?? "localhost"));
}

export function routeUpgrades(
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
