import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentRecord, type ControlMessage } from "./types";

// config.ts reads the environment when it is first imported, so every suite
// that depends on configuration stubs the env and then imports fresh modules.
async function loadApp(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return import("./app");
}

const agentDeps = () => ({
  listAgents: vi.fn<[], AgentRecord[]>(() => []),
  pushToAgent: vi.fn<(id: string, message: ControlMessage) => void>(),
});

describe("routes", () => {
  let deps: ReturnType<typeof agentDeps>;

  beforeEach(() => {
    deps = agentDeps();
  });

  it("returns known agents", async () => {
    const { createApp } = await loadApp({ SPECTRE_DEV_NO_AUTH: "1" });
    const agents: AgentRecord[] = [
      { id: "a1", connectionId: "conn-a1", address: "1.2.3.4:5", status: "connected", lastSeen: 1 },
    ];
    deps.listAgents = vi.fn(() => agents);

    const res = await request(createApp(deps)).get("/api/agents");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(agents);
  });

  it("validates commands and forwards them", async () => {
    const { createApp } = await loadApp({ SPECTRE_DEV_NO_AUTH: "1" });
    const app = createApp(deps);

    const missing = await request(app).post("/api/agents/abc/command").send({});
    expect(missing.status).toBe(400);
    expect(deps.pushToAgent).not.toHaveBeenCalled();

    const ok = await request(app).post("/api/agents/abc/command").send({ data: "ls" });
    expect(ok.status).toBe(200);
    expect(deps.pushToAgent).toHaveBeenCalledWith("abc", { type: "keystroke", data: "ls" });
  });

  it("refreshes agent info on request", async () => {
    const { createApp } = await loadApp({ SPECTRE_DEV_NO_AUTH: "1" });
    const refreshDockerInfo = vi.fn();
    const refreshSystemInfo = vi.fn();
    const refreshNetworkInfo = vi.fn();
    const app = createApp({ ...deps, refreshDockerInfo, refreshSystemInfo, refreshNetworkInfo });

    expect((await request(app).post("/api/agents/refresh-docker")).status).toBe(200);
    expect((await request(app).post("/api/agents/refresh-network")).status).toBe(200);
    expect((await request(app).post("/api/agents/refresh-system")).status).toBe(200);

    expect(refreshDockerInfo).toHaveBeenCalledTimes(1);
    expect(refreshSystemInfo).toHaveBeenCalledTimes(1);
    expect(refreshNetworkInfo).toHaveBeenCalledTimes(1);
  });

  it("forwards an update request to the machine", async () => {
    const { createApp } = await loadApp({ SPECTRE_DEV_NO_AUTH: "1" });
    const app = createApp(deps);

    const res = await request(app).post("/api/agents/abc/update").send({ version: "v1.5.0" });

    expect(res.status).toBe(200);
    expect(deps.pushToAgent).toHaveBeenCalledWith("abc", { type: "update", version: "v1.5.0" });
  });

  it("lets the machine choose when no version is pinned", async () => {
    const { createApp } = await loadApp({ SPECTRE_DEV_NO_AUTH: "1" });
    const res = await request(createApp(deps)).post("/api/agents/abc/update").send({});

    expect(res.status).toBe(200);
    expect(deps.pushToAgent).toHaveBeenCalledWith("abc", { type: "update", version: undefined });
  });

  it("rejects a version that is not a version", async () => {
    const { createApp } = await loadApp({ SPECTRE_DEV_NO_AUTH: "1" });
    const app = createApp(deps);

    for (const version of ["../../etc/passwd", "; rm -rf /", "latest", ""]) {
      const res = await request(app).post("/api/agents/abc/update").send({ version });
      expect(res.status).toBe(400);
    }
    expect(deps.pushToAgent).not.toHaveBeenCalled();
  });

  // The request rides the machine's live socket; there is nowhere to put it
  // when the machine is offline, and the UI should say so rather than pretend.
  it("reports a conflict when the machine is not connected", async () => {
    const { createApp } = await loadApp({ SPECTRE_DEV_NO_AUTH: "1" });
    deps.pushToAgent = vi.fn(() => {
      throw new Error("agent not connected");
    });

    const res = await request(createApp(deps)).post("/api/agents/abc/update").send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("agent not connected");
  });

  it("no longer exposes an endpoint that dials arbitrary addresses", async () => {
    const { createApp } = await loadApp({ SPECTRE_DEV_NO_AUTH: "1" });
    const res = await request(createApp(deps)).post("/api/agents/connect").send({ address: "ws://169.254.169.254/" });
    expect(res.status).toBe(404);
  });
});

describe("authentication", () => {
  const password = "correct-horse-battery-staple";

  it("rejects unauthenticated access to agent data", async () => {
    const { createApp } = await loadApp({ ADMIN_PASSWORD: password });
    const res = await request(createApp(agentDeps())).get("/api/agents");
    expect(res.status).toBe(401);
  });

  it("issues a session for the right password and rejects the wrong one", async () => {
    const { createApp } = await loadApp({ ADMIN_PASSWORD: password });
    const app = createApp(agentDeps());

    const bad = await request(app).post("/api/auth/login").send({ password: "nope" });
    expect(bad.status).toBe(401);
    expect(bad.body.token).toBeUndefined();

    const good = await request(app).post("/api/auth/login").send({ password });
    expect(good.status).toBe(200);
    expect(good.body.token).toEqual(expect.any(String));

    const authed = await request(app).get("/api/agents").set("Authorization", `Bearer ${good.body.token}`);
    expect(authed.status).toBe(200);
  });

  it("rejects a token that is not a real session", async () => {
    const { createApp } = await loadApp({ ADMIN_PASSWORD: password });
    const res = await request(createApp(agentDeps())).get("/api/agents").set("Authorization", "Bearer made-up");
    expect(res.status).toBe(401);
  });

  it("stops a password from being brute-forced", async () => {
    const { createApp } = await loadApp({ ADMIN_PASSWORD: password });
    const app = createApp(agentDeps());

    let sawLockout = false;
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app).post("/api/auth/login").send({ password: `guess-${i}` });
      if (res.status === 429) sawLockout = true;
    }
    expect(sawLockout).toBe(true);

    // The correct password is refused too while locked out; that is the point.
    const locked = await request(app).post("/api/auth/login").send({ password });
    expect(locked.status).toBe(429);
  });

  it("ends a session on logout", async () => {
    const { createApp } = await loadApp({ ADMIN_PASSWORD: password });
    const app = createApp(agentDeps());

    const { body } = await request(app).post("/api/auth/login").send({ password });
    const auth = { Authorization: `Bearer ${body.token}` };

    expect((await request(app).post("/api/auth/logout").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/agents").set(auth)).status).toBe(401);
  });

  it("keeps liveness and version public", async () => {
    const { createApp } = await loadApp({ ADMIN_PASSWORD: password });
    const app = createApp(agentDeps());
    expect((await request(app).get("/api/healthz")).status).toBe(200);
    expect((await request(app).get("/api/version")).status).toBe(200);
  });
});

describe("websocket tickets", () => {
  const password = "correct-horse-battery-staple";

  it("issues single-use tickets and refuses to reuse them", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("ADMIN_PASSWORD", password);

    const { createApp } = await import("./app");
    const { redeemWsTicket } = await import("./auth");
    const app = createApp(agentDeps());

    const { body } = await request(app).post("/api/auth/login").send({ password });
    const res = await request(app).post("/api/auth/ws-ticket").set("Authorization", `Bearer ${body.token}`);

    expect(res.status).toBe(200);
    expect(redeemWsTicket(res.body.ticket)).toBe(true);
    // A ticket that leaks into a log is worthless the moment it is used once.
    expect(redeemWsTicket(res.body.ticket)).toBe(false);
  });

  it("requires a session to mint a ticket", async () => {
    const { createApp } = await loadApp({ ADMIN_PASSWORD: password });
    expect((await request(createApp(agentDeps())).post("/api/auth/ws-ticket")).status).toBe(401);
  });
});

describe("CORS", () => {
  it("never reflects an unknown origin", async () => {
    const { createApp } = await loadApp({ SPECTRE_DEV_NO_AUTH: "1", CORS_ORIGIN: "https://spectre.example.com" });
    const app = createApp(agentDeps());

    const evil = await request(app).get("/api/agents").set("Origin", "https://evil.example.com");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();

    const allowed = await request(app).get("/api/agents").set("Origin", "https://spectre.example.com");
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://spectre.example.com");
  });

  it("does not allow any origin by default", async () => {
    const { createApp } = await loadApp({ SPECTRE_DEV_NO_AUTH: "1" });
    const res = await request(createApp(agentDeps())).get("/api/agents").set("Origin", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
