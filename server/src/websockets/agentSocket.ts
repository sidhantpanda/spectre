import { type IncomingMessage } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { registerInboundAgent } from "../agentRegistry";
import { findDeviceByKey, isInitialized as isDeviceStoreInitialized, redeemAuthKey, touchDevice } from "../deviceStore";
import { type ControlMessage } from "../types";
import { inboundAddress } from "../utils/net";

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

export type AgentAuth = { deviceStoreId: string; issuedDeviceKey?: string };

/**
 * Authenticates an agent from its handshake request.
 *
 * Runs before the WebSocket handshake is completed, so an unauthenticated peer
 * never gets an open socket. Returns null to reject.
 */
export function authenticateAgent(req: IncomingMessage): AgentAuth | null {
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

export function handleInboundAgents(inboundAgentWss: WebSocketServer) {
  inboundAgentWss.on("connection", (socket: WebSocket, req: IncomingMessage, auth: AgentAuth) => {
    registerInboundAgent(socket, inboundAddress(req), auth.deviceStoreId);
    if (auth.issuedDeviceKey) {
      socket.send(JSON.stringify({ type: "enrolled", deviceKey: auth.issuedDeviceKey } satisfies ControlMessage));
    }
  });
}
