import WebSocket from "ws";
import { isInitialized as isDeviceStoreInitialized, listPendingDevices } from "../deviceStore";
import { type AgentRecord } from "../types";

/**
 * A connected browser tab, and the session it is currently attached to.
 *
 * `sessionId` is null while the tab is sitting on the session picker, and is
 * bound the moment it attaches to or creates one.
 */
export type Viewer = { socket: WebSocket; sessionId: string | null };

export const uiClients: Map<string, Map<string, Viewer>> = new Map();
export const agentEventClients: Set<WebSocket> = new Set();

// Keystrokes are small; a peer sending more than this is not a terminal user.
export const MAX_UI_MESSAGE_BYTES = 64 * 1024;

/**
 * Payloads that belong to one session and must not leak into another tab.
 *
 * Everything else (status, session lists) is agent-wide and goes to every
 * viewer of that agent.
 */
const SESSION_SCOPED = new Set(["output", "sessionExited"]);

export function broadcastToUi(agentId: string, payload: { type: string; [key: string]: unknown }) {
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

export function broadcastAgentEvent(record: AgentRecord) {
  for (const socket of agentEventClients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "agent", agent: record }));
    }
  }
}

/**
 * Tells every open dashboard that a machine could not update itself.
 *
 * Without this the button sits on "Updating..." forever: it clears when the
 * machine comes back on a new version, and a failed update means that never
 * happens.
 */
export function broadcastUpdateFailure(agentId: string, error: string) {
  const raw = JSON.stringify({ type: "updateFailed", agentId, error });
  for (const socket of agentEventClients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(raw);
  }
}

/**
 * Machines waiting for approval, pushed to every open dashboard.
 *
 * They are not devices yet — there is no credential and no socket — but they
 * belong on the same list as the machines that are, or a new machine sits
 * unnoticed until someone reloads the page.
 */
export function broadcastPendingDevices() {
  if (!isDeviceStoreInitialized()) return;
  const raw = JSON.stringify({ type: "pending", pending: listPendingDevices() });
  for (const socket of agentEventClients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(raw);
  }
}
