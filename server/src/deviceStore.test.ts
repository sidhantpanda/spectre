import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvePendingDevice,
  canonicalAgentRecordFor,
  createAuthKey,
  createPendingDevice,
  deleteDevice,
  denyPendingDevice,
  findDeviceByKey,
  initDeviceStore,
  listAgentRecords,
  listAuthKeys,
  listConnections,
  listDevices,
  listPendingDevices,
  onPendingDevicesChange,
  pollPendingDevice,
  recordDeviceConnected,
  recordDeviceDisconnected,
  redeemAuthKey,
  resetStoreForTest,
  revokeAuthKey,
  revokeDevice,
} from "./deviceStore";
import { type AgentFingerprint } from "./types";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-store-"));
  initDeviceStore(dataDir);
});

afterEach(() => {
  resetStoreForTest();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** The raw database bytes, to assert no plaintext secret is persisted. */
function dbBytes(): string {
  return fs.readFileSync(path.join(dataDir, "spectre.db"), "latin1");
}

function fingerprint(overrides: Partial<AgentFingerprint> = {}): AgentFingerprint {
  return {
    hostname: "build-box",
    machineId: "machine-1234",
    macAddresses: ["aa:bb:cc:dd:ee:ff"],
    nics: ["eth0"],
    ...overrides,
  };
}

describe("auth keys", () => {
  it("enrols a device and issues it a device key", () => {
    const { key } = createAuthKey({});
    const enrolled = redeemAuthKey(key);
    expect(enrolled?.deviceKey).toMatch(/^dk_/);
    expect(findDeviceByKey(enrolled!.deviceKey)?.id).toBe(enrolled!.device.id);
  });

  it("burns a single-use key so a leaked key cannot enrol twice", () => {
    const { key } = createAuthKey({ reusable: false });
    expect(redeemAuthKey(key)).not.toBeNull();
    expect(redeemAuthKey(key)).toBeNull();
  });

  it("lets a reusable key enrol many machines", () => {
    const { key } = createAuthKey({ reusable: true });
    expect(redeemAuthKey(key)).not.toBeNull();
    expect(redeemAuthKey(key)).not.toBeNull();
  });

  it("refuses expired and revoked keys", () => {
    const expired = createAuthKey({ expiresInMs: -1 });
    expect(redeemAuthKey(expired.key)).toBeNull();

    const { key, record } = createAuthKey({ reusable: true });
    expect(revokeAuthKey(record.id)).toBe(true);
    expect(redeemAuthKey(key)).toBeNull();
  });

  it("never stores or returns the plaintext key", () => {
    const { key } = createAuthKey({ description: "ci" });
    expect(dbBytes()).not.toContain(key);
    expect(JSON.stringify(listAuthKeys())).not.toContain(key);
  });
});

describe("device keys", () => {
  it("never stores the plaintext device key", () => {
    const enrolled = redeemAuthKey(createAuthKey({}).key)!;
    expect(dbBytes()).not.toContain(enrolled.deviceKey);
  });

  it("never exposes key material over the device list", () => {
    const enrolled = redeemAuthKey(createAuthKey({}).key)!;
    const serialized = JSON.stringify(listDevices());
    expect(serialized).not.toContain(enrolled.deviceKey);
    expect(serialized).not.toContain("keyHash");
  });

  it("removes a disconnected device and its whole identity group", () => {
    const enrolled = redeemAuthKey(createAuthKey({}).key)!;
    const fp = fingerprint();
    const conn = recordDeviceConnected(enrolled.device.id, { address: "1.2.3.4", fingerprint: fp });
    recordDeviceDisconnected(enrolled.device.id, conn.connectionId, "closed");

    expect(deleteDevice(enrolled.device.id)).toBe("ok");
    expect(listDevices().some((d) => d.id === enrolled.device.id)).toBe(false);
    expect(listConnections(enrolled.device.id)).toHaveLength(0);
    expect(findDeviceByKey(enrolled.deviceKey)).toBeNull();
  });

  it("refuses to remove a connected device", () => {
    const enrolled = redeemAuthKey(createAuthKey({}).key)!;
    recordDeviceConnected(enrolled.device.id, { address: "1.2.3.4", fingerprint: fingerprint() });
    expect(deleteDevice(enrolled.device.id)).toBe("connected");
    expect(listDevices().some((d) => d.id === enrolled.device.id)).toBe(true);
  });

  it("reports when there is no such device to remove", () => {
    expect(deleteDevice("does-not-exist")).toBe("not_found");
  });

  it("stops authenticating a revoked device", () => {
    const enrolled = redeemAuthKey(createAuthKey({}).key)!;
    // A device must have connected (and thus have an identity) for revoke-by-identity.
    recordDeviceConnected(enrolled.device.id, { address: "1.2.3.4", fingerprint: fingerprint() });
    expect(revokeDevice(enrolled.device.id)).toBe(true);
    expect(findDeviceByKey(enrolled.deviceKey)).toBeNull();
  });
});

describe("device identity (the reconnect fix)", () => {
  it("shows one device across a disconnect and reconnect", () => {
    const enrolled = redeemAuthKey(createAuthKey({}).key)!;
    const fp = fingerprint();

    const first = recordDeviceConnected(enrolled.device.id, { address: "1.2.3.4", fingerprint: fp });
    expect(listAgentRecords().filter((a) => a.status === "connected")).toHaveLength(1);

    recordDeviceDisconnected(enrolled.device.id, first.connectionId, "closed");
    recordDeviceConnected(enrolled.device.id, { address: "1.2.3.4", fingerprint: fp });

    const records = listAgentRecords();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("connected");
  });

  it("reports a device that has never connected as connecting, not disconnected", () => {
    // Between being issued a credential and its first hello, a machine is on its
    // way in. Showing it as disconnected reads as a machine that has died.
    const enrolled = redeemAuthKey(createAuthKey({}).key)!;
    expect(listAgentRecords()[0].status).toBe("connecting");

    const conn = recordDeviceConnected(enrolled.device.id, { address: "1.2.3.4", fingerprint: fingerprint() });
    recordDeviceDisconnected(enrolled.device.id, conn.connectionId, "closed");
    expect(listAgentRecords()[0].status).toBe("disconnected");
  });

  it("collapses a machine re-enrolled with a new key into one device", () => {
    const fp = fingerprint(); // same hardware, same machine-id

    const firstEnroll = redeemAuthKey(createAuthKey({}).key)!;
    const c1 = recordDeviceConnected(firstEnroll.device.id, { address: "1.2.3.4", fingerprint: fp });
    recordDeviceDisconnected(firstEnroll.device.id, c1.connectionId, "closed");

    // device-info.json deleted -> agent enrols again with a new key, same MAC/machine-id.
    const secondEnroll = redeemAuthKey(createAuthKey({}).key)!;
    expect(secondEnroll.device.id).not.toBe(firstEnroll.device.id);
    recordDeviceConnected(secondEnroll.device.id, { address: "1.2.3.4", fingerprint: fp });

    const records = listAgentRecords();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("connected");
  });

  it("keeps genuinely different machines separate", () => {
    const a = redeemAuthKey(createAuthKey({}).key)!;
    const b = redeemAuthKey(createAuthKey({}).key)!;
    recordDeviceConnected(a.device.id, { address: "1.1.1.1", fingerprint: fingerprint({ machineId: "aaa", macAddresses: ["aa:aa:aa:aa:aa:aa"] }) });
    recordDeviceConnected(b.device.id, { address: "2.2.2.2", fingerprint: fingerprint({ machineId: "bbb", macAddresses: ["bb:bb:bb:bb:bb:bb"] }) });
    expect(listAgentRecords()).toHaveLength(2);
  });

  it("identifies by MAC when there is no machine-id (e.g. macOS)", () => {
    const fp = fingerprint({ machineId: "", macAddresses: ["de:ad:be:ef:00:01"] });
    const e1 = redeemAuthKey(createAuthKey({}).key)!;
    const c1 = recordDeviceConnected(e1.device.id, { address: "1.2.3.4", fingerprint: fp });
    recordDeviceDisconnected(e1.device.id, c1.connectionId);

    const e2 = redeemAuthKey(createAuthKey({}).key)!;
    recordDeviceConnected(e2.device.id, { address: "1.2.3.4", fingerprint: fp });

    expect(listAgentRecords()).toHaveLength(1);
  });
});

describe("connection history", () => {
  it("records a row per connection with connect and disconnect times", () => {
    const enrolled = redeemAuthKey(createAuthKey({}).key)!;
    const c1 = recordDeviceConnected(enrolled.device.id, { address: "9.9.9.9", fingerprint: fingerprint() });
    recordDeviceDisconnected(enrolled.device.id, c1.connectionId, "closed");
    recordDeviceConnected(enrolled.device.id, { address: "9.9.9.9", fingerprint: fingerprint() });

    const history = listConnections(enrolled.device.id);
    expect(history).toHaveLength(2);
    expect(history[0].disconnectedAt).toBeUndefined(); // newest, still open
    expect(history[1].disconnectedAt).toBeGreaterThan(0);
    expect(history[1].closeReason).toBe("closed");
  });
});

describe("interactive approval", () => {
  it("hands over a device key only after approval, exactly once", () => {
    const pending = createPendingDevice({ hostname: "build-box" });
    expect(pollPendingDevice(pending.pollToken)).toEqual({ status: "pending" });

    approvePendingDevice(pending.userCode);

    const result = pollPendingDevice(pending.pollToken);
    expect(result.status).toBe("approved");
    expect(result.status === "approved" && result.deviceKey).toMatch(/^dk_/);
    expect(pollPendingDevice(pending.pollToken).status).toBe("expired");
  });

  it("names the device after the host that asked", () => {
    const pending = createPendingDevice({ hostname: "build-box" });
    const device = approvePendingDevice(pending.userCode);
    expect(device?.name).toBe("build-box");
  });

  it("drops a denied request", () => {
    const pending = createPendingDevice({ hostname: "build-box" });
    expect(denyPendingDevice(pending.userCode)).toBe(true);
    expect(pollPendingDevice(pending.pollToken).status).toBe("expired");
    expect(listPendingDevices()).toHaveLength(0);
  });

  it("announces every change to the pending set", () => {
    const seen: number[] = [];
    const unsubscribe = onPendingDevicesChange(() => seen.push(listPendingDevices().length));

    const first = createPendingDevice({ hostname: "build-box" });
    const second = createPendingDevice({ hostname: "laptop" });
    denyPendingDevice(second.userCode);
    approvePendingDevice(first.userCode);

    // create, create, deny, approve — the dashboard needs all four, or a machine
    // sits on the list after it has been dealt with.
    expect(seen).toEqual([1, 2, 1, 0]);
    unsubscribe();
  });

  it("never stores the poll token or issued key in the clear", () => {
    const pending = createPendingDevice({ hostname: "build-box" });
    approvePendingDevice(pending.userCode);
    const bytesBeforeClaim = dbBytes();
    const result = pollPendingDevice(pending.pollToken);
    const deviceKey = result.status === "approved" ? result.deviceKey : "";

    expect(bytesBeforeClaim).not.toContain(pending.pollToken);
    expect(bytesBeforeClaim).not.toContain(deviceKey);
    expect(dbBytes()).not.toContain(deviceKey);
  });
});

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
