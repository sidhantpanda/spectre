export const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
export const DATA_DIR = process.env.DATA_DIR || "./data";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

// Spectre hands out root shells. An unauthenticated server is not a degraded
// mode, it is a breach, so we refuse to serve rather than fail open. Local
// development opts out explicitly via SPECTRE_DEV_NO_AUTH=1.
export const DEV_NO_AUTH = process.env.SPECTRE_DEV_NO_AUTH === "1";

// Browsers are same-origin by default and the UI is normally proxied onto the
// same origin as the API, so "no cross-origin access" is the correct default.
export const CORS_ORIGIN = process.env.CORS_ORIGIN || "";

const MIN_PASSWORD_LENGTH = 12;

export class ConfigError extends Error {}

export function validateConfig() {
  if (DEV_NO_AUTH) {
    if (process.env.NODE_ENV === "production") {
      throw new ConfigError(
        "SPECTRE_DEV_NO_AUTH=1 is set with NODE_ENV=production. Authentication cannot be disabled in production.",
      );
    }
    console.warn(
      "WARNING: SPECTRE_DEV_NO_AUTH=1 - authentication is disabled. Never use this outside local development.",
    );
    return;
  }

  if (!ADMIN_PASSWORD) {
    throw new ConfigError(
      [
        "ADMIN_PASSWORD is not set.",
        "",
        "Spectre grants shell access to every enrolled machine, so it will not",
        "start without a password. Generate one with:",
        "",
        "    openssl rand -base64 24",
        "",
        "then set it in your environment or compose file:",
        "",
        "    ADMIN_PASSWORD=<generated-password>",
        "",
        "For local development only, set SPECTRE_DEV_NO_AUTH=1 instead.",
      ].join("\n"),
    );
  }

  // Checked before the length rule so a copy-pasted placeholder gets the
  // message that actually explains the problem.
  const weak = new Set(["changeme", "change-me", "password", "admin", "spectre", "letmein", "secret"]);
  if (weak.has(ADMIN_PASSWORD.toLowerCase())) {
    throw new ConfigError(
      "ADMIN_PASSWORD is a well-known placeholder value. Generate a real one with: openssl rand -base64 24",
    );
  }

  if (ADMIN_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    throw new ConfigError(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (got ${ADMIN_PASSWORD.length}). Generate one with: openssl rand -base64 24`,
    );
  }
}

export function corsOrigins(): string[] {
  return CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
