let cachedVersion: string | undefined;

export function getServerVersion() {
  if (!cachedVersion) {
    const raw = process.env.SPECTRE_SERVER_VERSION;
    cachedVersion = raw && raw.trim().length > 0 ? raw : `dev-${Math.floor(Date.now() / 1000)}`;
  }
  return cachedVersion;
}
