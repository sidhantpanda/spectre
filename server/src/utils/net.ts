import { type IncomingMessage } from "http";
import { type Request } from "express";

export function inboundAddress(req: IncomingMessage) {
  const ip = req.socket.remoteAddress ?? "inbound";
  const port = req.socket.remotePort;
  return port ? `${ip}:${port}` : ip;
}

/**
 * Identifies a client for rate-limiting purposes.
 *
 * Deliberately uses the socket address rather than X-Forwarded-For: that header
 * is attacker-controlled unless a trusted proxy overwrites it, and honouring it
 * blindly would let anyone bypass the login limiter by varying the header.
 * Setting TRUST_PROXY=1 is the operator asserting that a proxy owns it.
 */
export function clientKey(req: Request | IncomingMessage): string {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = req.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = value?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Strips the query string so credentials never reach the logs. */
export function safePath(url: string | undefined): string {
  if (!url) return "";
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : `${url.slice(0, queryIndex)}?<redacted>`;
}
