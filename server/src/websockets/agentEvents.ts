import WebSocket, { WebSocketServer } from "ws";
import { listAgents } from "../agentRegistry";
import { isInitialized as isDeviceStoreInitialized, listPendingDevices } from "../deviceStore";
import { agentEventClients } from "./clients";

export function handleAgentEventStream(agentEventsWss: WebSocketServer) {
  agentEventsWss.on("connection", (socket: WebSocket) => {
    agentEventClients.add(socket);
    socket.send(JSON.stringify({ type: "agents", agents: listAgents() }));
    if (isDeviceStoreInitialized()) {
      socket.send(JSON.stringify({ type: "pending", pending: listPendingDevices() }));
    }
    socket.on("close", () => agentEventClients.delete(socket));
  });
}
