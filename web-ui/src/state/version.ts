import { getApiBase } from "../lib/api";

const API_BASE = getApiBase();

type VersionResponse = {
  version?: string;
};

export async function fetchServerVersion(apiBase: string = API_BASE): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase}/version`);
    if (!res.ok) return null;
    const payload = (await res.json()) as VersionResponse;
    if (payload.version && payload.version.length > 0) {
      return payload.version;
    }
  } catch {
    // ignore version lookup failures
  }
  return null;
}
