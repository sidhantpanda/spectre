import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./lib/format";
import { renderApp, setupAppTest } from "./testUtils";

describe("formatting helpers", () => {
  it("formats timestamps in local time", () => {
    const sample = new Date("2024-01-01T12:00:00Z").getTime();
    expect(formatTimestamp(sample)).toBe(new Date(sample).toLocaleTimeString());
  });
});

describe("App component", () => {
  setupAppTest();

  it("loads and displays empty state", async () => {
    renderApp();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.getByText(/No connections yet/i)).toBeInTheDocument();
  });
});
