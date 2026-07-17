import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  // Vitest inherits the real environment; clear anything that would mask the case.
  vi.stubEnv("ADMIN_PASSWORD", env.ADMIN_PASSWORD ?? "");
  vi.stubEnv("SPECTRE_DEV_NO_AUTH", env.SPECTRE_DEV_NO_AUTH ?? "");
  vi.stubEnv("NODE_ENV", env.NODE_ENV ?? "test");
  return import("./config");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("validateConfig", () => {
  it("refuses to run without a password", async () => {
    const { validateConfig, ConfigError } = await loadConfig({});
    // A Spectre server with no password is an anonymous root shell, so this
    // must be a hard failure rather than a warning.
    expect(() => validateConfig()).toThrow(ConfigError);
  });

  it("refuses well-known placeholder passwords", async () => {
    const { validateConfig } = await loadConfig({ ADMIN_PASSWORD: "changeme" });
    expect(() => validateConfig()).toThrow(/placeholder/i);
  });

  it("refuses short passwords", async () => {
    const { validateConfig } = await loadConfig({ ADMIN_PASSWORD: "short" });
    expect(() => validateConfig()).toThrow(/at least/i);
  });

  it("accepts a strong password", async () => {
    const { validateConfig } = await loadConfig({ ADMIN_PASSWORD: "correct-horse-battery-staple" });
    expect(() => validateConfig()).not.toThrow();
  });

  it("allows auth to be disabled for local development", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { validateConfig } = await loadConfig({ SPECTRE_DEV_NO_AUTH: "1" });
    expect(() => validateConfig()).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/authentication is disabled/i));
  });

  it("never allows auth to be disabled in production", async () => {
    const { validateConfig } = await loadConfig({ SPECTRE_DEV_NO_AUTH: "1", NODE_ENV: "production" });
    expect(() => validateConfig()).toThrow(/production/i);
  });

  it("keeps auth on when a password is set, even with the dev flag", async () => {
    // Setting a password means the user wants auth; the dev flag must not
    // silently turn it off (this was the 'no prompt, then login on refresh' bug).
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { validateConfig } = await loadConfig({ ADMIN_PASSWORD: "test", SPECTRE_DEV_NO_AUTH: "1" });
    expect(() => validateConfig()).not.toThrow();
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/authentication is enabled/i));
  });

  it("does not enforce password strength in dev mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    // A weak dev password is fine; the strength gate is for real deployments.
    const { validateConfig } = await loadConfig({ ADMIN_PASSWORD: "test", SPECTRE_DEV_NO_AUTH: "1" });
    expect(() => validateConfig()).not.toThrow();
  });

  it("still enforces password strength in production even alongside the dev flag being unset", async () => {
    const { validateConfig } = await loadConfig({ ADMIN_PASSWORD: "short", NODE_ENV: "production" });
    expect(() => validateConfig()).toThrow(/at least/i);
  });
});

describe("isAuthEnabled", () => {
  async function loadAuth(env: Record<string, string>) {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("ADMIN_PASSWORD", env.ADMIN_PASSWORD ?? "");
    vi.stubEnv("SPECTRE_DEV_NO_AUTH", env.SPECTRE_DEV_NO_AUTH ?? "");
    return import("./auth");
  }

  it("is on whenever a password is set", async () => {
    const { isAuthEnabled } = await loadAuth({ ADMIN_PASSWORD: "correct-horse-battery-staple" });
    expect(isAuthEnabled()).toBe(true);
  });

  it("is on with a password even when the dev flag is set", async () => {
    const { isAuthEnabled } = await loadAuth({ ADMIN_PASSWORD: "test", SPECTRE_DEV_NO_AUTH: "1" });
    expect(isAuthEnabled()).toBe(true);
  });

  it("is off only when no password is set", async () => {
    const { isAuthEnabled } = await loadAuth({ SPECTRE_DEV_NO_AUTH: "1" });
    expect(isAuthEnabled()).toBe(false);
  });
});

describe("corsOrigins", () => {
  it("is empty by default", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CORS_ORIGIN", "");
    const { corsOrigins } = await import("./config");
    expect(corsOrigins()).toEqual([]);
  });

  it("parses a comma-separated list", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("CORS_ORIGIN", "https://a.example.com, https://b.example.com");
    const { corsOrigins } = await import("./config");
    expect(corsOrigins()).toEqual(["https://a.example.com", "https://b.example.com"]);
  });
});
