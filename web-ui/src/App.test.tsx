import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import App, { formatTimestamp } from "./App";
import { ThemeProvider } from "./components/ThemeProvider";

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
  }

  send() {}

  close() {
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }
}

describe("App helpers", () => {
  it("formats timestamps in local time", () => {
    const sample = new Date("2024-01-01T12:00:00Z").getTime();
    expect(formatTimestamp(sample)).toBe(new Date(sample).toLocaleTimeString());
  });
});

describe("App component", () => {
  beforeEach(() => {
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
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: "p1", userCode: "WXYZ-ABCD", hostname: "build-box", createdAt: 0, expiresAt: Date.now() + 1000 },
            ]),
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

    expect(await screen.findByText(/1 machine waiting for approval/i)).toBeInTheDocument();
    expect(screen.getByText(/WXYZ-ABCD/)).toBeInTheDocument();
  });
});
