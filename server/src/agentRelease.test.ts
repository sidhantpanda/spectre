import { afterEach, describe, expect, it } from "vitest";
import { getLatestAgentVersion, setLatestAgentVersionForTest, updateAvailableFor } from "./agentRelease";

afterEach(() => setLatestAgentVersionForTest(undefined));

describe("updateAvailableFor", () => {
  it("offers an update when the machine runs something other than the release", () => {
    expect(updateAvailableFor("v1.4.0", "v1.5.0")).toBe(true);
  });

  it("does not offer one when the versions match", () => {
    expect(updateAvailableFor("v1.5.0", "v1.5.0")).toBe(false);
  });

  it("tolerates the leading v being present on only one side", () => {
    expect(updateAvailableFor("1.5.0", "v1.5.0")).toBe(false);
    expect(updateAvailableFor("v1.5.0", "1.5.0")).toBe(false);
  });

  it("flags a dev build as not what we ship", () => {
    expect(updateAvailableFor("dev-1785700000", "v1.5.0")).toBe(true);
  });

  // GitHub being unreachable or rate-limited must hide the button, not guess.
  it("offers nothing when the latest release is unknown", () => {
    expect(updateAvailableFor("v1.4.0", undefined)).toBe(false);
  });

  // Old agents predate the version in the hello message.
  it("offers nothing when the machine reports no version", () => {
    expect(updateAvailableFor(undefined, "v1.5.0")).toBe(false);
  });

  it("reads the cached version when no explicit latest is passed", () => {
    setLatestAgentVersionForTest("v2.0.0");
    expect(getLatestAgentVersion()).toBe("v2.0.0");
    expect(updateAvailableFor("v1.0.0")).toBe(true);
    expect(updateAvailableFor("v2.0.0")).toBe(false);
  });
});
