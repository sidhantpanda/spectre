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

  it("submits connection details", async () => {
    const fetchMock = globalThis.fetch as unknown as Mock;
    const responses = [
      Promise.resolve({ json: () => Promise.resolve([]) }),
      Promise.resolve({ json: () => Promise.resolve({}) }),
      Promise.resolve({ json: () => Promise.resolve([]) }),
    ];
    fetchMock.mockImplementation(() => responses.shift() as Promise<Response>);

    render(
      <ThemeProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );

    const addressInput = screen.getByLabelText(/Agent WebSocket URL/i);
    fireEvent.change(addressInput, { target: { value: "ws://test/ws" } });
    const tokenInput = screen.getByLabelText(/Token/i);
    fireEvent.change(tokenInput, { target: { value: "secret" } });

    const submit = screen.getByRole("button", { name: /connect/i });
    fireEvent.click(submit);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${window.location.origin}/agents/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: "ws://test/ws", token: "secret" }),
    });
  });
});
