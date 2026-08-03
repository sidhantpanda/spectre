/**
 * What the newest published agent release is, so the dashboard can offer an
 * update for machines running something older.
 *
 * Held in memory and refreshed on a timer. Every read is synchronous and never
 * waits on GitHub: an unreachable or rate-limited GitHub means "no update
 * offered", which is the right failure — it hides a button, it does not break
 * the machine list.
 */

const RELEASE_URL = "https://api.github.com/repos/sidhantpanda/spectre/releases/latest";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

let latestVersion: string | undefined;
let lastFetchedAt = 0;
let inFlight: Promise<void> | null = null;

/** Test seam. */
export function setLatestAgentVersionForTest(version: string | undefined) {
  latestVersion = version;
  lastFetchedAt = version ? Date.now() : 0;
}

export function getLatestAgentVersion(): string | undefined {
  return latestVersion;
}

/**
 * Compares release tags, tolerating a leading "v" on either side.
 *
 * Deliberately an inequality rather than "is newer": a machine on a dev build,
 * or one somehow ahead of the published release, is still worth flagging as
 * "not what we ship". The button names the exact version it installs.
 */
export function updateAvailableFor(agentVersion: string | undefined, latest = latestVersion): boolean {
  if (!agentVersion || !latest) return false;
  const norm = (v: string) => v.trim().replace(/^v/, "");
  return norm(agentVersion) !== norm(latest);
}

/** Fetches the latest release tag, at most one request at a time. */
export async function refreshLatestAgentVersion(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(RELEASE_URL, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "spectre-server" },
        signal: controller.signal,
      });
      if (!res.ok) {
        // Rate limiting is normal on a busy IP and is not worth a stack trace.
        console.warn(`[release] GitHub returned HTTP ${res.status} for the latest agent release`);
        return;
      }
      const body = (await res.json()) as { tag_name?: string };
      if (body.tag_name) {
        latestVersion = body.tag_name;
        lastFetchedAt = Date.now();
      }
    } catch (err) {
      console.warn(`[release] could not check the latest agent release: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Warms the cache at boot and keeps it fresh. Unref'd so the timer never holds
 * the process open.
 */
export function startAgentReleaseWatch() {
  void refreshLatestAgentVersion();
  const timer = setInterval(() => {
    if (Date.now() - lastFetchedAt < REFRESH_INTERVAL_MS) return;
    void refreshLatestAgentVersion();
  }, REFRESH_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
