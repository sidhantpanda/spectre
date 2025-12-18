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

export function buildWsUrl(path: string, apiBase?: string) {
  const base = apiBase && apiBase.length > 0 ? apiBase : getApiBase();
  const url = new URL(path, base);
  url.protocol = url.protocol.replace("http", "ws");
  return url.toString();
}
