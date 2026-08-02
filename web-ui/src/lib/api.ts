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

/** The origin serving this page, or the API's own origin when it is elsewhere. */
export function getServerOrigin() {
  return (ENV_BASE ?? window.location.origin).replace(/\/+$/, "");
}

/**
 * Base for every API call. The control server mounts everything under /api,
 * which is also how the reverse proxy tells API traffic apart from the static
 * UI it serves on the same origin.
 */
export function getApiBase() {
  return `${getServerOrigin()}/api`;
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
  // Concatenated, not resolved: `new URL("/terminal", ".../api")` would discard
  // the /api prefix, since a root-relative path replaces the whole base path.
  const url = new URL(`${base}${path}`);
  url.protocol = url.protocol.replace("http", "ws");

  const res = await authFetch(`${base}/auth/ws-ticket`, { method: "POST" });
  if (res.ok) {
    const { ticket } = (await res.json()) as { ticket?: string };
    if (ticket) url.searchParams.set("ticket", ticket);
  }
  return url.toString();
}
