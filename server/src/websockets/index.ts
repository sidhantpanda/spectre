import { type Server as HttpServer } from "http";
import { WebSocketServer } from "ws";
import { onAgentOutput, onAgentStatusChange } from "../agentRegistry";
import { onPendingDevicesChange } from "../deviceStore";
import { handleAgentEventStream } from "./agentEvents";
import { handleInboundAgents } from "./agentSocket";
import { broadcastAgentEvent, broadcastPendingDevices, broadcastToUi, MAX_UI_MESSAGE_BYTES } from "./clients";
import { handleUiConnection } from "./terminalSocket";
import { routeUpgrades } from "./upgrade";

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

  onPendingDevicesChange(() => broadcastPendingDevices());

  const uiWss = new WebSocketServer({ noServer: true, maxPayload: MAX_UI_MESSAGE_BYTES });
  const agentEventsWss = new WebSocketServer({ noServer: true, maxPayload: MAX_UI_MESSAGE_BYTES });
  const inboundAgentWss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  handleUiConnection(uiWss);
  handleAgentEventStream(agentEventsWss);
  handleInboundAgents(inboundAgentWss);
  routeUpgrades(httpServer, uiWss, agentEventsWss, inboundAgentWss);
}
