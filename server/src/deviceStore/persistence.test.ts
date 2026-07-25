import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { canonicalAgentRecordFor, createAuthKey, initDeviceStore, listAgentRecords, listDevices, recordDeviceConnected, redeemAuthKey, resetStoreForTest } from "./index";
import { dataDir, fingerprint, setupStoreTest } from "./testStore";

setupStoreTest();

describe("persistence", () => {
  it("keeps devices across a store reopen, marked disconnected", () => {
    const enrolled = redeemAuthKey(createAuthKey({}).key)!;
    recordDeviceConnected(enrolled.device.id, { address: "1.2.3.4", fingerprint: fingerprint() });
    expect(listAgentRecords()[0].status).toBe("connected");

    // Simulate a server restart against the same data directory.
    resetStoreForTest();
    initDeviceStore(dataDir);

    const records = listAgentRecords();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("disconnected");
    expect(canonicalAgentRecordFor(enrolled.device.id)?.status).toBe("disconnected");
  });

  it("imports a legacy store.json once", () => {
    resetStoreForTest();
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-legacy-"));
    fs.writeFileSync(
      path.join(legacyDir, "store.json"),
      JSON.stringify({
        devices: [{ id: "dev-1", keyHash: "hash-1", enrolledAt: 1, lastSeen: 2 }],
        authKeys: [],
      }),
    );

    initDeviceStore(legacyDir);
    expect(listDevices().some((d) => d.id === "dev-1")).toBe(true);
    // The legacy file is moved aside so it isn't re-imported.
    expect(fs.existsSync(path.join(legacyDir, "store.json"))).toBe(false);
    expect(fs.existsSync(path.join(legacyDir, "store.json.imported"))).toBe(true);

    resetStoreForTest();
    fs.rmSync(legacyDir, { recursive: true, force: true });
  });
});

describe("store file", () => {
  it("is not readable by other users on the host", () => {
    createAuthKey({});
    const mode = fs.statSync(path.join(dataDir, "spectre.db")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
