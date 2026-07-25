import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, type Mock } from "vitest";
import { renderApp, setupAppTest } from "../testUtils";

describe("AgentListItem", () => {
  setupAppTest();

  it("keeps a machine's inventory behind Show more", async () => {
    const agent = {
      id: "dev-1",
      connectionId: "c1",
      address: "192.168.1.27",
      status: "connected",
      lastSeen: Date.now(),
      identity: "mid:abc123",
      agentVersion: "dev-1",
      fingerprint: { hostname: "ams-1-rpi3-1", macAddresses: [], nics: [] },
      systemInfo: {
        os: "Debian GNU/Linux 13",
        version: "13",
        cpu: "Cortex-A53",
        arch: "arm64",
        cores: 4,
        memoryBytes: 950000000,
        diskTotalBytes: 31000000000,
        diskFreeBytes: 23000000000,
      },
      networkInfo: { ipv4: ["192.168.1.27"], ipv6: [] },
      docker: [{ name: "adguardhome", ports: ["0.0.0.0:53->53/tcp"] }],
    };
    const fetchMock = globalThis.fetch as unknown as Mock;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${window.location.origin}/agents`) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([agent]) }) as unknown as Promise<Response>;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Promise<Response>;
    });

    renderApp();

    // Collapsed: the host and a one-line summary, none of the inventory.
    expect(await screen.findByText("ams-1-rpi3-1")).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.27 · Debian GNU\/Linux 13 · 4 cores \(arm64\)/)).toBeInTheDocument();
    expect(screen.queryByText("Docker Containers")).not.toBeInTheDocument();
    expect(screen.queryByText("adguardhome")).not.toBeInTheDocument();
    expect(screen.queryByText("mid:abc123")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(screen.getByText("Docker Containers")).toBeInTheDocument();
    expect(screen.getByText("adguardhome")).toBeInTheDocument();
    expect(screen.getByText("mid:abc123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByText("adguardhome")).not.toBeInTheDocument();
  });
});
