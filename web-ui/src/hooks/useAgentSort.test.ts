import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAgentSort } from "./useAgentSort";

const STORAGE_KEY = "agent-sort-preference";

describe("useAgentSort", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to A–Z when nothing is stored", () => {
    const { result } = renderHook(() => useAgentSort());
    expect(result.current[0]).toBe("name-asc");
  });

  it("restores a previously stored sort", () => {
    window.localStorage.setItem(STORAGE_KEY, "last-connected-desc");
    const { result } = renderHook(() => useAgentSort());
    expect(result.current[0]).toBe("last-connected-desc");
  });

  it("persists a change", () => {
    const { result } = renderHook(() => useAgentSort());

    act(() => result.current[1]("name-desc"));

    expect(result.current[0]).toBe("name-desc");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("name-desc");
  });

  it("survives a remount", () => {
    const first = renderHook(() => useAgentSort());
    act(() => first.result.current[1]("last-connected-asc"));
    first.unmount();

    const { result } = renderHook(() => useAgentSort());
    expect(result.current[0]).toBe("last-connected-asc");
  });

  it("falls back to the default when the stored value is not a known sort", () => {
    window.localStorage.setItem(STORAGE_KEY, "by-vibes");
    const { result } = renderHook(() => useAgentSort());
    expect(result.current[0]).toBe("name-asc");
  });
});
