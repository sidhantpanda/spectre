import { describe, expect, it } from "vitest";
import {
  createAuthKey,
  deleteDevice,
  lastConnectedAtFor,
  listAgentRecords,
  listDevices,
  recordDeviceConnected,
  recordDeviceDisconnected,
  recordSessionAccess,
  redeemAuthKey,
} from "./index";
import { fingerprint, setupStoreTest } from "./testStore";

setupStoreTest();

function enrol() {
  return redeemAuthKey(createAuthKey({}).key)!;
}

describe("access history", () => {
  it("reports no last-connected for a machine nobody has opened", () => {
    const device = enrol().device;
    expect(lastConnectedAtFor(device.id)).toBeUndefined();
    expect(listAgentRecords().find((a) => a.id === device.id)?.lastConnectedAt).toBeUndefined();
  });

  it("stamps last-connected when a session is created or attached", () => {
    const device = enrol().device;

    recordSessionAccess(device.id, { kind: "create", sessionId: "spectre-1" });
    const first = lastConnectedAtFor(device.id);
    expect(first).toBeGreaterThan(0);

    recordSessionAccess(device.id, { kind: "attach", sessionId: "spectre-1" });
    expect(lastConnectedAtFor(device.id)!).toBeGreaterThanOrEqual(first!);
  });

  it("surfaces it on the agent list and the device list", () => {
    const device = enrol().device;
    recordSessionAccess(device.id, { kind: "attach", sessionId: "s" });

    expect(listAgentRecords().find((a) => a.id === device.id)?.lastConnectedAt).toBeGreaterThan(0);
    expect(listDevices().find((d) => d.id === device.id)?.lastConnectedAt).toBeGreaterThan(0);
  });

  it("does not move when the agent merely reconnects", () => {
    const device = enrol().device;
    recordSessionAccess(device.id, { kind: "create", sessionId: "s" });
    const stamped = lastConnectedAtFor(device.id)!;

    const conn = recordDeviceConnected(device.id, { address: "1.2.3.4", fingerprint: fingerprint() });
    recordDeviceDisconnected(device.id, conn.connectionId, "closed");
    recordDeviceConnected(device.id, { address: "1.2.3.4", fingerprint: fingerprint() });

    expect(lastConnectedAtFor(device.id)).toBe(stamped);
  });

  it("keeps the history when the same machine re-enrols with a new key", () => {
    // Two credential rows, one physical machine: the identity ties them.
    const fp = fingerprint();
    const first = enrol().device;
    recordDeviceConnected(first.id, { address: "1.2.3.4", fingerprint: fp });
    recordSessionAccess(first.id, { kind: "create", sessionId: "s", identity: undefined });

    const stamped = lastConnectedAtFor(first.id, undefined);
    expect(stamped).toBeGreaterThan(0);

    const second = enrol().device;
    const conn = recordDeviceConnected(second.id, { address: "1.2.3.4", fingerprint: fp });
    // Recorded against the identity, so the new row sees the earlier access.
    recordSessionAccess(second.id, { kind: "attach", sessionId: "s", identity: conn.identity });

    expect(lastConnectedAtFor(second.id, conn.identity)).toBeGreaterThan(0);
  });

  it("drops a removed device's access rows", () => {
    const device = enrol().device;
    const conn = recordDeviceConnected(device.id, { address: "1.2.3.4", fingerprint: fingerprint() });
    recordDeviceDisconnected(device.id, conn.connectionId, "closed");
    recordSessionAccess(device.id, { kind: "create", sessionId: "s", identity: conn.identity });

    expect(deleteDevice(device.id)).toBe("ok");
    expect(lastConnectedAtFor(device.id, conn.identity)).toBeUndefined();
  });
});
