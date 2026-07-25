import { describe, expect, it } from "vitest";
import { approvePendingDevice, createPendingDevice, denyPendingDevice, listPendingDevices, onPendingDevicesChange, pollPendingDevice } from "./index";
import { dbBytes, setupStoreTest } from "./testStore";

setupStoreTest();

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
