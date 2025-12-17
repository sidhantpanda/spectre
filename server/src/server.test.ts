import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "./server";
import { AgentRecord, ControlMessage } from "./types";

describe("createApp routes", () => {
  let listAgents = vi.fn<[], AgentRecord[]>();
  let connectToAgent = vi.fn<(address: string, token: string) => AgentRecord>();
  let pushToAgent = vi.fn<(id: string, message: ControlMessage) => void>();

  beforeEach(() => {
    listAgents = vi.fn(() => []);
    connectToAgent = vi.fn((address: string, token: string) => ({
      id: "id-1",
      connectionId: "conn-1",
      address,
      status: "connecting",
      lastSeen: 123,
      remoteAgentId: token,
      direction: "outbound",
    }));
    pushToAgent = vi.fn();
  });

  it("returns known agents", async () => {
    const agents: AgentRecord[] = [
      {
        id: "a1",
        connectionId: "conn-a1",
        address: "ws://example",
        status: "connected",
        lastSeen: 1,
        direction: "outbound",
      },
    ];
    listAgents = vi.fn(() => agents);

    const app = createApp({ listAgents, connectToAgent, pushToAgent }, "token");
    const res = await request(app).get("/agents");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(agents);
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  it("validates connect request body", async () => {
    const app = createApp({ listAgents, connectToAgent, pushToAgent }, "token");
    const res = await request(app).post("/agents/connect").send({});

    expect(res.status).toBe(400);
    expect(connectToAgent).not.toHaveBeenCalled();
  });

  it("uses provided token or default", async () => {
    const app = createApp({ listAgents, connectToAgent, pushToAgent }, "fallback");

    await request(app)
      .post("/agents/connect")
      .send({ address: "ws://remote/ws" });
    await request(app)
      .post("/agents/connect")
      .send({ address: "ws://remote/ws", token: "custom" });

    expect(connectToAgent).toHaveBeenNthCalledWith(1, "ws://remote/ws", "fallback");
    expect(connectToAgent).toHaveBeenNthCalledWith(2, "ws://remote/ws", "custom");
  });

  it("validates commands and forwards to push helper", async () => {
    const app = createApp({ listAgents, connectToAgent, pushToAgent }, "token");

    const missingRes = await request(app)
      .post("/agents/abc/command")
      .send({});
    expect(missingRes.status).toBe(400);
    expect(pushToAgent).not.toHaveBeenCalled();

    const okRes = await request(app)
      .post("/agents/abc/command")
      .send({ data: "ls" });

    expect(okRes.status).toBe(200);
    expect(pushToAgent).toHaveBeenCalledWith("abc", { type: "keystroke", data: "ls" });
    expect(okRes.body).toEqual({ status: "sent" });
  });

  it("refreshes docker info when requested", async () => {
    const refreshDockerInfo = vi.fn();
    const app = createApp({ listAgents, connectToAgent, pushToAgent, refreshDockerInfo }, "token");

    const res = await request(app).post("/agents/refresh-docker");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "requested" });
    expect(refreshDockerInfo).toHaveBeenCalledTimes(1);
  });

  it("refreshes system info when requested", async () => {
    const refreshSystemInfo = vi.fn();
    const app = createApp({ listAgents, connectToAgent, pushToAgent, refreshSystemInfo }, "token");

    const res = await request(app).post("/agents/refresh-system");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "requested" });
    expect(refreshSystemInfo).toHaveBeenCalledTimes(1);
  });

  it("refreshes network info when requested", async () => {
    const refreshNetworkInfo = vi.fn();
    const app = createApp({ listAgents, connectToAgent, pushToAgent, refreshNetworkInfo }, "token");

    const res = await request(app).post("/agents/refresh-network");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "requested" });
    expect(refreshNetworkInfo).toHaveBeenCalledTimes(1);
  });
});
