// Shared temp-dir store setup used by the deviceStore test files. Not a
// `.test.ts` file itself — vitest's `beforeEach`/`afterEach` are called from
// `setupStoreTest()`, invoked at the top of each test file's own describe tree.
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach } from "vitest";
import { initDeviceStore, resetStoreForTest } from "./index";
import { type AgentFingerprint } from "../types";

export let dataDir: string;

export function setupStoreTest() {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-store-"));
    initDeviceStore(dataDir);
  });

  afterEach(() => {
    resetStoreForTest();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
}

/** The raw database bytes, to assert no plaintext secret is persisted. */
export function dbBytes(): string {
  return fs.readFileSync(path.join(dataDir, "spectre.db"), "latin1");
}

export function fingerprint(overrides: Partial<AgentFingerprint> = {}): AgentFingerprint {
  return {
    hostname: "build-box",
    machineId: "machine-1234",
    macAddresses: ["aa:bb:cc:dd:ee:ff"],
    nics: ["eth0"],
    ...overrides,
  };
}
