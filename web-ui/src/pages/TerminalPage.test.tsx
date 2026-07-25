import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TerminalPage from "./TerminalPage";
import { ThemeProvider } from "../components/ThemeProvider";

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

const AGENT = {
  id: "dev-1",
  connectionId: "conn-1",
  address: "127.0.0.1",
  status: "connected",
  lastSeen: Date.now(),
  deviceId: "dev-1",
};

const SESSION = { id: "spectre-abc", attached: false, managed: true, live: true, createdAt: 0 };

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {}

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

function terminalSocket() {
  const socket = MockWebSocket.instances.find((s) => s.url.includes("/terminal"));
  if (!socket) throw new Error("terminal socket not opened");
  return socket;
}

function sentTypes(socket: MockWebSocket) {
  return socket.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);
}

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderTerminal(path: string) {
  // StrictMode mirrors main.tsx: effects mount twice, which the attach/detach
  // sync has to survive.
  return render(
    <StrictMode>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/agent/:deviceId" element={<TerminalPage />} />
            <Route path="/agent/:deviceId/:sessionId" element={<TerminalPage />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </ThemeProvider>
    </StrictMode>,
  );
}

describe("TerminalPage session routing", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).endsWith("/auth/ws-ticket")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ticket: "t" }) }) as unknown as Promise<Response>;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([AGENT]) }) as unknown as Promise<Response>;
    }) as unknown as typeof fetch;
    // The component gates sends on `WebSocket.OPEN`, so the stub constructor
    // needs the readyState constants a bare vi.fn() would not carry.
    const ctor = vi.fn((url: string) => new MockWebSocket(url));
    globalThis.WebSocket = Object.assign(ctor, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    }) as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it("attaches from the picker and returns to it on ← Sessions", async () => {
    renderTerminal("/agent/dev-1");

    await waitFor(() => terminalSocket());
    const socket = terminalSocket();
    act(() => socket.emit({ type: "sessions", sessions: [SESSION], tmuxAvailable: true }));

    fireEvent.click(await screen.findByText(SESSION.id));
    await waitFor(() => expect(sentTypes(socket)).toContain("attach"));
    act(() => socket.emit({ type: "attached", sessionId: SESSION.id }));

    expect(await screen.findByTestId("terminal-dev-1")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(`/agent/dev-1/${SESSION.id}`);

    const attachesBefore = sentTypes(socket).filter((type) => type === "attach").length;
    fireEvent.click(screen.getByRole("button", { name: /Sessions/ }));
    // The server answers a detach by re-listing sessions.
    act(() => socket.emit({ type: "sessions", sessions: [SESSION], tmuxAvailable: true }));

    await waitFor(() => expect(screen.queryByTestId("terminal-dev-1")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: /Sessions/ })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/agent/dev-1");
    expect(sentTypes(socket)).toContain("detach");
    // Leaving must not be read as a request to attach all over again.
    expect(sentTypes(socket).filter((type) => type === "attach").length).toBe(attachesBefore);
  });

  it("attaches straight to a session named in the route", async () => {
    renderTerminal(`/agent/dev-1/${SESSION.id}`);

    await waitFor(() => terminalSocket());
    const socket = terminalSocket();
    act(() => socket.emit({ type: "sessions", sessions: [SESSION], tmuxAvailable: true }));

    await waitFor(() => expect(sentTypes(socket)).toContain("attach"));
    act(() => socket.emit({ type: "attached", sessionId: SESSION.id }));
    expect(await screen.findByTestId("terminal-dev-1")).toBeInTheDocument();

    // Opening a session means wanting to type in it: the first keystroke should
    // land in the terminal without clicking it first.
    await waitFor(() =>
      expect(document.activeElement).toHaveClass("xterm-helper-textarea"),
    );
  });

  it("returns to the picker after a session it auto-created", async () => {
    renderTerminal("/agent/dev-1");

    await waitFor(() => terminalSocket());
    const socket = terminalSocket();
    // An empty host auto-creates, and the server names the session.
    act(() => socket.emit({ type: "sessions", sessions: [], tmuxAvailable: true }));
    await waitFor(() => expect(sentTypes(socket)).toContain("create"));
    const created = { ...SESSION, id: "spectre-new" };
    act(() => {
      socket.emit({ type: "attached", sessionId: created.id });
      socket.emit({ type: "sessions", sessions: [created], tmuxAvailable: true });
    });
    expect(await screen.findByTestId("terminal-dev-1")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(`/agent/dev-1/${created.id}`);

    fireEvent.click(screen.getByRole("button", { name: /Sessions/ }));
    act(() => socket.emit({ type: "sessions", sessions: [created], tmuxAvailable: true }));

    await waitFor(() => expect(screen.queryByTestId("terminal-dev-1")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: /Sessions/ })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/agent/dev-1");
    expect(sentTypes(socket)).not.toContain("attach");
  });

  it("falls back to the picker when the route names a dead session", async () => {
    renderTerminal("/agent/dev-1/spectre-gone");

    await waitFor(() => terminalSocket());
    const socket = terminalSocket();
    act(() => socket.emit({ type: "sessions", sessions: [SESSION], tmuxAvailable: true }));

    expect(await screen.findByText(/no longer running/i)).toBeInTheDocument();
    expect(sentTypes(socket)).not.toContain("attach");
  });
});
