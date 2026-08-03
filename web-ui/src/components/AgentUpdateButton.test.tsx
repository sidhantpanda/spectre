import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
import { renderApp, setupAppTest } from "../testUtils";

const base = {
  id: "dev-1",
  connectionId: "c1",
  address: "10.0.0.1:1",
  lastSeen: Date.now(),
  fingerprint: { hostname: "box", macAddresses: [], nics: [] },
};

function mockAgents(overrides: Record<string, unknown>) {
  const fetchMock = globalThis.fetch as unknown as Mock;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === `${window.location.origin}/api/agents` && (!init || init.method !== "POST")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ ...base, ...overrides }]),
      }) as unknown as Promise<Response>;
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Promise<Response>;
  });
  return fetchMock;
}

describe("agent update button", () => {
  setupAppTest();

  it("offers the exact version it will install", async () => {
    mockAgents({
      status: "connected",
      agentVersion: "v1.4.0",
      latestAgentVersion: "v1.5.0",
      updateAvailable: true,
    });
    renderApp();

    expect(await screen.findByRole("button", { name: "Update to v1.5.0" })).toBeInTheDocument();
  });

  it("stays hidden when the machine is already current", async () => {
    mockAgents({
      status: "connected",
      agentVersion: "v1.5.0",
      latestAgentVersion: "v1.5.0",
      updateAvailable: false,
    });
    renderApp();

    expect(await screen.findByText("box")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Update to/ })).not.toBeInTheDocument();
  });

  // The request rides the machine's live socket, so an offline machine has
  // nowhere to receive it.
  it("stays hidden for a disconnected machine", async () => {
    mockAgents({
      status: "disconnected",
      agentVersion: "v1.4.0",
      latestAgentVersion: "v1.5.0",
      updateAvailable: true,
    });
    renderApp();

    expect(await screen.findByText("box")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Update to/ })).not.toBeInTheDocument();
  });

  it("posts the pinned version and shows progress", async () => {
    const fetchMock = mockAgents({
      status: "connected",
      agentVersion: "v1.4.0",
      latestAgentVersion: "v1.5.0",
      updateAvailable: true,
    });
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Update to v1.5.0" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === `${window.location.origin}/api/agents/dev-1/update` &&
            (init as RequestInit)?.method === "POST" &&
            String((init as RequestInit)?.body).includes("v1.5.0"),
        ),
      ).toBe(true),
    );

    // Stays in progress: the machine has to download, swap and reconnect.
    expect(await screen.findByRole("button", { name: "Updating..." })).toBeDisabled();
  });

  it("clears progress once the machine reports a new version", async () => {
    mockAgents({
      status: "connected",
      agentVersion: "v1.4.0",
      latestAgentVersion: "v1.5.0",
      updateAvailable: true,
    });
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Update to v1.5.0" }));
    expect(await screen.findByRole("button", { name: "Updating..." })).toBeInTheDocument();

    // The agent comes back on the new build and re-announces itself.
    const { MockWebSocket } = await import("../testUtils");
    const socket = MockWebSocket.instances.at(-1);
    socket?.emit({
      type: "agent",
      agent: {
        ...base,
        status: "connected",
        agentVersion: "v1.5.0",
        latestAgentVersion: "v1.5.0",
        updateAvailable: false,
      },
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Updating..." })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Update to/ })).not.toBeInTheDocument();
  });

  it("surfaces a refused request and lets you try again", async () => {
    const fetchMock = mockAgents({
      status: "connected",
      agentVersion: "v1.4.0",
      latestAgentVersion: "v1.5.0",
      updateAvailable: true,
    });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/update")) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "agent not connected" }),
        }) as unknown as Promise<Response>;
      }
      if (url === `${window.location.origin}/api/agents` && (!init || init.method !== "POST")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { ...base, status: "connected", agentVersion: "v1.4.0", latestAgentVersion: "v1.5.0", updateAvailable: true },
            ]),
        }) as unknown as Promise<Response>;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Promise<Response>;
    });
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});

    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Update to v1.5.0" }));

    await waitFor(() => expect(alert).toHaveBeenCalledWith("agent not connected"));
    // Back to an actionable button rather than stuck on "Updating...".
    expect(await screen.findByRole("button", { name: "Update to v1.5.0" })).toBeEnabled();
  });

  // Without this the row would sit on "Updating..." forever: it clears when the
  // machine reports a new version, and a failed update means it never does.
  it("reports a failure pushed from the machine and re-offers the update", async () => {
    mockAgents({
      status: "connected",
      agentVersion: "v1.4.0",
      latestAgentVersion: "v1.5.0",
      updateAvailable: true,
    });
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Update to v1.5.0" }));
    expect(await screen.findByRole("button", { name: "Updating..." })).toBeInTheDocument();

    const { MockWebSocket } = await import("../testUtils");
    MockWebSocket.instances.at(-1)?.emit({
      type: "updateFailed",
      agentId: "dev-1",
      error: "cannot write to /usr/local/bin: permission denied",
    });

    expect(await screen.findByText(/Update failed: cannot write to \/usr\/local\/bin/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Update to v1.5.0" })).toBeEnabled();
  });
});
