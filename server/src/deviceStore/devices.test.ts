import { describe, expect, it } from "vitest";
import {
  createAuthKey,
  deleteDevice,
  findDeviceByKey,
  listAgentRecords,
  listConnections,
  listDevices,
  recordDeviceConnected,
  recordDeviceDisconnected,
  redeemAuthKey,
  revokeDevice,
} from "./index";
import { dbBytes, fingerprint, setupStoreTest } from "./testStore";

setupStoreTest();

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
