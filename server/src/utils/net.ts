import { type IncomingMessage } from "http";

export function inboundAddress(req: IncomingMessage) {
  const ip = req.socket.remoteAddress ?? "inbound";
  const port = req.socket.remotePort;
  return port ? `${ip}:${port}` : ip;
}
