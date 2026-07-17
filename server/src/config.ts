export const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
export const DATA_DIR = process.env.DATA_DIR || "./data";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

// SPECTRE_DEV_NO_AUTH only permits *starting without a password* for local
// development. It does not force auth off when a password is set: if you set
// ADMIN_PASSWORD, authentication is on. Auth being on or off is therefore a
// pure function of "is a password set", which keeps the UI consistent.
export const DEV_NO_AUTH = process.env.SPECTRE_DEV_NO_AUTH === "1";

// Browsers are same-origin by default and the UI is normally proxied onto the
// same origin as the API, so "no cross-origin access" is the correct default.
export const CORS_ORIGIN = process.env.CORS_ORIGIN || "";

// The externally-reachable base the agent should dial, e.g.
// "wss://spectre.example.com". Advertised in the UI's enrollment command. When
// unset, the server advertises its detected LAN address and API port, which is
// what a direct/self-hosted setup needs.
export const PUBLIC_HOST = process.env.SPECTRE_PUBLIC_HOST || "";

const MIN_PASSWORD_LENGTH = 12;
const WEAK_PASSWORDS = new Set(["changeme", "change-me", "password", "admin", "spectre", "letmein", "secret"]);

export class ConfigError extends Error {}

function assertStrongPassword(password: string) {
  // Checked before the length rule so a copy-pasted placeholder gets the
  // message that actually explains the problem.
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    throw new ConfigError(
      "ADMIN_PASSWORD is a well-known placeholder value. Generate a real one with: openssl rand -base64 24",
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ConfigError(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (got ${password.length}). Generate one with: openssl rand -base64 24`,
    );
  }
}

export function validateConfig() {
  const isProduction = process.env.NODE_ENV === "production";
  const devMode = DEV_NO_AUTH && !isProduction;

  if (DEV_NO_AUTH && isProduction) {
    throw new ConfigError(
      "SPECTRE_DEV_NO_AUTH=1 is set with NODE_ENV=production. Authentication cannot be disabled in production.",
    );
  }

  if (ADMIN_PASSWORD) {
    // A password means authentication is on. Enforce strength for real
    // deployments; a dev-mode server may use a weak password since the operator
    // has already opted into lowered guarantees.
    if (!devMode) {
      assertStrongPassword(ADMIN_PASSWORD);
    } else {
      console.log("ADMIN_PASSWORD is set, so authentication is enabled (SPECTRE_DEV_NO_AUTH is ignored).");
    }
    return;
  }

  // No password from here down.
  if (devMode) {
    console.warn(
      "WARNING: no ADMIN_PASSWORD set and SPECTRE_DEV_NO_AUTH=1 - authentication is disabled. Local development only.",
    );
    return;
  }

  throw new ConfigError(
    [
      "ADMIN_PASSWORD is not set.",
      "",
      "Spectre grants shell access to every enrolled machine, so it will not",
      "start without a password. Generate one with:",
      "",
      "    openssl rand -base64 24",
      "",
      "then set it in your environment or in a .env file:",
      "",
      "    ADMIN_PASSWORD=<generated-password>",
      "",
      "For local development only, set SPECTRE_DEV_NO_AUTH=1 instead.",
    ].join("\n"),
  );
}

export function corsOrigins(): string[] {
  return CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
