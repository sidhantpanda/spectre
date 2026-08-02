import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, type Mock } from "vitest";
import { MockWebSocket, PENDING, renderApp, setupAppTest } from "../testUtils";

describe("pending devices", () => {
  setupAppTest();

  it("surfaces machines waiting for approval", async () => {
    const fetchMock = globalThis.fetch as unknown as Mock;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${window.location.origin}/api/devices/pending`) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([PENDING]) }) as unknown as Promise<Response>;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Promise<Response>;
    });

    renderApp();

    expect(await screen.findByText(/1 machine waiting for approval/i)).toBeInTheDocument();
    expect(screen.getByText(/WXYZ-ABCD/)).toBeInTheDocument();
    // In the machine list itself, waiting for a decision rather than shown as a
    // dead connection.
    expect(await screen.findByText("Pending approval")).toBeInTheDocument();
    expect(screen.getByLabelText("Agent is pending approval")).toBeInTheDocument();
    expect(screen.queryByLabelText("Agent is disconnected")).not.toBeInTheDocument();
  });

  it("lists a machine pushed over the socket without a reload", async () => {
    renderApp();

    await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0));
    expect(screen.queryByText("Pending approval")).not.toBeInTheDocument();

    act(() => MockWebSocket.instances[0].emit({ type: "pending", pending: [PENDING] }));

    expect(await screen.findByText("Pending approval")).toBeInTheDocument();
    expect(screen.getByText("build-box")).toBeInTheDocument();
  });

  it("approves and rejects from the machine list", async () => {
    const fetchMock = globalThis.fetch as unknown as Mock;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${window.location.origin}/api/devices/pending`) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([PENDING]) }) as unknown as Promise<Response>;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Promise<Response>;
    });

    const { unmount } = renderApp();

    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => url === `${window.location.origin}/api/devices/pending/WXYZ-ABCD/approve`,
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("Pending approval")).not.toBeInTheDocument());

    unmount();
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: /reject/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === `${window.location.origin}/api/devices/pending/WXYZ-ABCD/deny`),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("Pending approval")).not.toBeInTheDocument());
  });
});
