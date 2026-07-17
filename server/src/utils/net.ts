import * as os from "os";
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

/** How reachable an address is likely to be from another machine, higher is better. */
function addressRank(ip: string): number {
  if (ip.startsWith("192.168.")) return 3; // typical home/office LAN
  if (ip.startsWith("10.")) return 2; // larger private networks
  const secondOctet = Number(ip.split(".")[1]);
  if (ip.startsWith("172.") && secondOctet >= 16 && secondOctet <= 31) return 1; // 172.16/12
  return 0; // other routable/public addresses
}

/**
 * Returns this host's IPv4 addresses that another machine on the network could
 * dial, best candidate first.
 *
 * Loopback and link-local (169.254.x, APIPA) addresses are excluded because an
 * agent on a different machine cannot reach them. Private LAN ranges are ranked
 * ahead of others since that is where agents almost always live.
 */
export function lanAddresses(): string[] {
  const candidates: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      // Node <18 types `family` as a string; newer as a number. Accept both.
      const isIPv4 = addr.family === "IPv4" || (addr.family as unknown as number) === 4;
      if (!isIPv4 || addr.internal) continue;
      if (addr.address.startsWith("169.254.")) continue;
      candidates.push(addr.address);
    }
  }
  return candidates.sort((a, b) => addressRank(b) - addressRank(a));
}

/**
 * Picks the single best address to advertise on the console, falling back to
 * "localhost" only when the host has no usable network address.
 */
export function primaryHostAddress(): string {
  return lanAddresses()[0] ?? "localhost";
}
