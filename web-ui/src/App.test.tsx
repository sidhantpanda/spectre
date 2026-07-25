import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import App from "./App";
import { formatTimestamp } from "./lib/format";
import { ThemeProvider } from "./components/ThemeProvider";

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send() {}

  close() {
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

const PENDING = { id: "p1", userCode: "WXYZ-ABCD", hostname: "build-box", createdAt: 0, expiresAt: Date.now() + 1000 };

describe("formatting helpers", () => {
  it("formats timestamps in local time", () => {
    const sample = new Date("2024-01-01T12:00:00Z").getTime();
    expect(formatTimestamp(sample)).toBe(new Date(sample).toLocaleTimeString());
  });
});

describe("App component", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      }) as unknown as Promise<Response>,
    );
    globalThis.WebSocket = vi.fn((url: string) => new MockWebSocket(url)) as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it("loads and displays empty state", async () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.getByText(/No connections yet/i)).toBeInTheDocument();
  });

  it("creates an auth key and shows the enrollment command", async () => {
    const fetchMock = globalThis.fetch as unknown as Mock;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${window.location.origin}/authkeys`) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "key-1",
              key: "sk_testkey123",
              hint: "sk_test",
              reusable: false,
              createdAt: Date.now(),
              expiresAt: Date.now() + 1000,
              uses: 0,
              revoked: false,
            }),
        }) as unknown as Promise<Response>;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Promise<Response>;
    });

    render(
      <ThemeProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /create auth key/i }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === `${window.location.origin}/authkeys`)).toBe(true),
    );

    // The plaintext key is returned once, so the UI must surface it in a
    // command the operator can run as-is.
    const command = await screen.findByText(/spectre-agent up --host .* --authkey sk_testkey123/);
    expect(command).toBeInTheDocument();
  });

  it("surfaces machines waiting for approval", async () => {
    const fetchMock = globalThis.fetch as unknown as Mock;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${window.location.origin}/devices/pending`) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([PENDING]) }) as unknown as Promise<Response>;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Promise<Response>;
    });

    render(
      <ThemeProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(await screen.findByText(/1 machine waiting for approval/i)).toBeInTheDocument();
    expect(screen.getByText(/WXYZ-ABCD/)).toBeInTheDocument();
    // In the machine list itself, waiting for a decision rather than shown as a
    // dead connection.
    expect(await screen.findByText("Pending approval")).toBeInTheDocument();
    expect(screen.getByLabelText("Agent is pending approval")).toBeInTheDocument();
    expect(screen.queryByLabelText("Agent is disconnected")).not.toBeInTheDocument();
  });

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

    render(
      <ThemeProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );

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

  it("lists a machine pushed over the socket without a reload", async () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );

    await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0));
    expect(screen.queryByText("Pending approval")).not.toBeInTheDocument();

    act(() => MockWebSocket.instances[0].emit({ type: "pending", pending: [PENDING] }));

    expect(await screen.findByText("Pending approval")).toBeInTheDocument();
    expect(screen.getByText("build-box")).toBeInTheDocument();
  });

  it("approves and rejects from the machine list", async () => {
    const fetchMock = globalThis.fetch as unknown as Mock;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${window.location.origin}/devices/pending`) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([PENDING]) }) as unknown as Promise<Response>;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Promise<Response>;
    });

    const { unmount } = render(
      <ThemeProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => url === `${window.location.origin}/devices/pending/WXYZ-ABCD/approve`,
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("Pending approval")).not.toBeInTheDocument());

    unmount();
    render(
      <ThemeProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /reject/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === `${window.location.origin}/devices/pending/WXYZ-ABCD/deny`),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("Pending approval")).not.toBeInTheDocument());
  });
});
