import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import App, { formatTimestamp, statusVariant } from "./App";

const originalFetch = global.fetch;

describe("App helpers", () => {
  it("formats timestamps in local time", () => {
    const sample = new Date("2024-01-01T12:00:00Z").getTime();
    expect(formatTimestamp(sample)).toBe(new Date(sample).toLocaleTimeString());
  });

  it("maps status to badge variants", () => {
    expect(statusVariant("connected")).toBe("outline");
    expect(statusVariant("connecting")).toBe("secondary");
    expect(statusVariant("disconnected")).toBe("destructive");
  });
});

describe("App component", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve([]),
      }) as unknown as Promise<Response>,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("loads and displays empty state", async () => {
    render(<App />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByText(/No connections yet/i)).toBeInTheDocument();
  });

  it("submits connection details", async () => {
    const fetchMock = global.fetch as unknown as Mock;
    const responses = [
      Promise.resolve({ json: () => Promise.resolve([]) }),
      Promise.resolve({ json: () => Promise.resolve({}) }),
      Promise.resolve({ json: () => Promise.resolve([]) }),
    ];
    fetchMock.mockImplementation(() => responses.shift() as Promise<Response>);

    render(<App />);

    const addressInput = screen.getByLabelText(/Agent WebSocket URL/i);
    fireEvent.change(addressInput, { target: { value: "ws://test/ws" } });
    const tokenInput = screen.getByLabelText(/Token/i);
    fireEvent.change(tokenInput, { target: { value: "secret" } });

    const submit = screen.getByRole("button", { name: /connect/i });
    fireEvent.click(submit);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/agents/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: "ws://test/ws", token: "secret" }),
    });
  });
});
