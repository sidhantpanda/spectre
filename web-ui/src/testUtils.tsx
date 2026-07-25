// Shared mock setup for App-level tests: a fake WebSocket the tests can push
// events through, a fetch stub, and a render helper for the app's provider
// tree. Not a `.test.tsx` file itself — call `setupAppTest()` at the top of
// each test file's own describe tree.
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import App from "./App";
import { ThemeProvider } from "./components/ThemeProvider";

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

export class MockWebSocket {
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

export const PENDING = {
  id: "p1",
  userCode: "WXYZ-ABCD",
  hostname: "build-box",
  createdAt: 0,
  expiresAt: Date.now() + 1000,
};

export function setupAppTest() {
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
}

export function renderApp() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </ThemeProvider>,
  );
}
