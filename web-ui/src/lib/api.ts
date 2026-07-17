import { authFetch } from "./auth";

const RUNTIME_BASE =
  typeof window !== "undefined" &&
  window.__ENV?.SPECTRE_SERVER_HOST &&
  window.__ENV.SPECTRE_SERVER_HOST.length > 0
    ? window.__ENV.SPECTRE_SERVER_HOST
    : undefined;
const ENV_BASE =
  RUNTIME_BASE ??
  ((import.meta.env.SPECTRE_SERVER_HOST as string | undefined) &&
    (import.meta.env.SPECTRE_SERVER_HOST as string).length > 0
    ? (import.meta.env.SPECTRE_SERVER_HOST as string)
    : undefined);

export function getApiBase() {
  return ENV_BASE ?? window.location.origin;
}

/**
 * Builds an authenticated WebSocket URL.
 *
 * A browser cannot set headers on a WebSocket handshake, so the session token
 * would otherwise have to ride in the query string, where it lands in proxy and
 * access logs and survives long after the page is closed. Instead the session
 * is exchanged for a single-use ticket that expires in seconds.
 */
export async function buildWsUrl(path: string, apiBase?: string): Promise<string> {
  const base = apiBase && apiBase.length > 0 ? apiBase : getApiBase();
  const url = new URL(path, base);
  url.protocol = url.protocol.replace("http", "ws");

  const res = await authFetch(`${base}/auth/ws-ticket`, { method: "POST" });
  if (res.ok) {
    const { ticket } = (await res.json()) as { ticket?: string };
    if (ticket) url.searchParams.set("ticket", ticket);
  }
  return url.toString();
}
