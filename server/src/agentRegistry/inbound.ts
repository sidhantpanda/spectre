import WebSocket, { type RawData } from "ws";
import { markDeviceSeen, recordDeviceConnected, recordDeviceDisconnected, updateDeviceRuntime } from "../deviceStore";
import { type AgentMessage, type ControlMessage } from "../types";
import { summarizeOutput } from "../utils/output";
import { connections, identityToStoreId } from "./connections";
import { emitDeviceUpdate, emitOutput, emitUpdateFailure } from "./events";
import { requestDockerInfo, requestNetworkInfo, requestSystemInfo } from "./info";

const MAX_AGENT_MESSAGE_BYTES = 256 * 1024;
const DEBUG_TERMINAL = process.env.SPECTRE_DEBUG_TERMINAL === "1";

export function registerInboundAgent(socket: WebSocket, address: string, deviceStoreId?: string) {
  // Enrollment always resolves a device row before the socket is accepted.
  if (!deviceStoreId) {
    socket.close(4401, "unidentified device");
    return;
  }

  let connectionId: string | null = null;

  socket.on("message", (data: RawData) => {
    const raw = data.toString();
    if (raw.length > MAX_AGENT_MESSAGE_BYTES) {
      console.warn(`[agent] oversized message from ${address}, closing`);
      socket.close(1009, "message too large");
      return;
    }

    let payload: AgentMessage;
    try {
      payload = JSON.parse(raw) as AgentMessage;
    } catch {
      console.warn(`[agent] malformed message from ${address}`);
      return;
    }

    switch (payload.type) {
      case "hello": {
        const { connectionId: cid, identity } = recordDeviceConnected(deviceStoreId, {
          address,
          agentDeviceId: payload.agentId,
          agentVersion: payload.agentVersion,
          fingerprint: payload.fingerprint,
        });
        connectionId = cid;

        // One live socket per physical device: if this machine already had a
        // connection (a ghost from a dropped link, or a duplicate agent), close
        // the old one and let the newest win.
        const previousStoreId = identityToStoreId.get(identity);
        if (previousStoreId && previousStoreId !== deviceStoreId) {
          connections.get(previousStoreId)?.socket.close(4004, "superseded by newer connection");
          connections.delete(previousStoreId);
        }
        const sameKeyGhost = connections.get(deviceStoreId);
        if (sameKeyGhost && sameKeyGhost.socket !== socket && sameKeyGhost.socket.readyState === WebSocket.OPEN) {
          sameKeyGhost.socket.close(4004, "superseded by newer connection");
        }

        connections.set(deviceStoreId, { socket, deviceStoreId, connectionId: cid, identity });
        identityToStoreId.set(identity, deviceStoreId);

        socket.send(JSON.stringify({ type: "hello" } satisfies ControlMessage));
        emitDeviceUpdate(deviceStoreId);
        requestDockerInfo(deviceStoreId);
        requestSystemInfo(deviceStoreId);
        requestNetworkInfo(deviceStoreId);
        return;
      }
      case "output": {
        emitOutput(deviceStoreId, payload);
        if (DEBUG_TERMINAL) {
          const summary = summarizeOutput(payload.data);
          if (summary) console.log(`[agent ${deviceStoreId}] ${summary}`);
        }
        return;
      }
      case "heartbeat":
        markDeviceSeen(deviceStoreId);
        return;
      // Session lifecycle is relayed straight through to the UI; the server
      // keeps no session state of its own, because tmux on the agent's host is
      // the only thing that actually knows which sessions exist.
      case "sessions":
      case "sessionOpened":
      case "sessionClosed":
      case "sessionExited":
        emitOutput(deviceStoreId, payload);
        return;
      case "dockerInfo":
        updateDeviceRuntime(deviceStoreId, { docker: payload.containers ?? [] });
        emitDeviceUpdate(deviceStoreId);
        return;
      case "systemInfo":
        if (payload.systemInfo) updateDeviceRuntime(deviceStoreId, { systemInfo: payload.systemInfo });
        emitDeviceUpdate(deviceStoreId);
        return;
      case "networkInfo":
        if (payload.networkInfo) updateDeviceRuntime(deviceStoreId, { networkInfo: payload.networkInfo });
        emitDeviceUpdate(deviceStoreId);
        return;
      case "updateStatus":
        // Logged, not stored: a successful update ends with the agent
        // restarting and re-announcing its version, which is what the
        // dashboard actually reflects. A failure is only useful in the log.
        if (payload.state === "failed") {
          console.warn(`[update] ${deviceStoreId} failed to update: ${payload.error ?? "unknown error"}`);
          emitUpdateFailure(deviceStoreId, payload.error ?? "update failed");
        } else {
          console.log(`[update] ${deviceStoreId} ${payload.state}${payload.version ? ` ${payload.version}` : ""}`);
        }
        emitOutput(deviceStoreId, payload);
        return;
    }
  });

  const teardown = (reason: string) => {
    // Only tear down if this socket is still the current one for the device; a
    // newer connection may have already replaced it.
    const current = connections.get(deviceStoreId);
    if (current && current.socket !== socket) return;

    if (connectionId) recordDeviceDisconnected(deviceStoreId, connectionId, reason);
    else recordDeviceDisconnected(deviceStoreId, "", reason);

    connections.delete(deviceStoreId);
    const conn = current;
    if (conn && identityToStoreId.get(conn.identity) === deviceStoreId) {
      identityToStoreId.delete(conn.identity);
    }
    emitDeviceUpdate(deviceStoreId);
  };

  socket.on("close", () => {
    console.log(`[agent] closed ${address} (device=${deviceStoreId})`);
    teardown("connection closed");
  });

  socket.on("error", (err: Error) => {
    console.warn(`[agent] error ${address} (device=${deviceStoreId}): ${err.message}`);
    teardown(err.message);
  });
}
