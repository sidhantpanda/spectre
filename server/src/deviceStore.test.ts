import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvePendingDevice,
  createAuthKey,
  createPendingDevice,
  denyPendingDevice,
  findDeviceByKey,
  initDeviceStore,
  listAuthKeys,
  listDevices,
  listPendingDevices,
  pollPendingDevice,
  redeemAuthKey,
  revokeAuthKey,
  revokeDevice,
} from "./deviceStore";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-store-"));
  initDeviceStore(dataDir);
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function readStore() {
  return fs.readFileSync(path.join(dataDir, "store.json"), "utf-8");
}

describe("auth keys", () => {
  it("enrols a device and issues it a device key", async () => {
    const { key } = createAuthKey({});
    const enrolled = redeemAuthKey(key);

    expect(enrolled).not.toBeNull();
    expect(enrolled?.deviceKey).toMatch(/^dk_/);
    expect(findDeviceByKey(enrolled!.deviceKey)?.id).toBe(enrolled!.device.id);
  });

  it("burns a single-use key so a leaked key cannot enrol twice", async () => {
    const { key } = createAuthKey({ reusable: false });

    expect(redeemAuthKey(key)).not.toBeNull();
    expect(redeemAuthKey(key)).toBeNull();
    expect(listDevices()).toHaveLength(1);
  });

  it("lets a reusable key enrol many machines", async () => {
    const { key } = createAuthKey({ reusable: true });

    expect(redeemAuthKey(key)).not.toBeNull();
    expect(redeemAuthKey(key)).not.toBeNull();
    expect(listDevices()).toHaveLength(2);
  });

  it("refuses an expired key", async () => {
    const { key } = createAuthKey({ expiresInMs: -1 });
    expect(redeemAuthKey(key)).toBeNull();
  });

  it("refuses a revoked key", async () => {
    const { key, record } = createAuthKey({ reusable: true });
    expect(revokeAuthKey(record.id)).toBe(true);
    expect(redeemAuthKey(key)).toBeNull();
  });

  it("refuses an unknown key", async () => {
    expect(redeemAuthKey("sk_not_a_real_key")).toBeNull();
  });

  it("never stores or lists the plaintext key", async () => {
    const { key } = createAuthKey({ description: "ci runners" });

    // Reading store.json must not be enough to enrol a machine.
    expect(readStore()).not.toContain(key);
    expect(JSON.stringify(listAuthKeys())).not.toContain(key);
  });
});

describe("device keys", () => {
  it("never stores the plaintext device key", async () => {
    const { key } = createAuthKey({});
    const enrolled = redeemAuthKey(key)!;

    expect(readStore()).not.toContain(enrolled.deviceKey);
  });

  it("never exposes key material over the API surface", async () => {
    const { key } = createAuthKey({});
    const enrolled = redeemAuthKey(key)!;

    const serialized = JSON.stringify(listDevices());
    expect(serialized).not.toContain(enrolled.deviceKey);
    expect(serialized).not.toContain("keyHash");
  });

  it("stops authenticating a revoked device", async () => {
    const { key } = createAuthKey({});
    const enrolled = redeemAuthKey(key)!;

    expect(revokeDevice(enrolled.device.id)).toBe(true);
    expect(findDeviceByKey(enrolled.deviceKey)).toBeNull();
  });

  it("rejects an unknown device key", async () => {
    expect(findDeviceByKey("dk_nonsense")).toBeNull();
  });
});

describe("interactive approval", () => {
  it("hands over a device key only after approval", async () => {
    const pending = createPendingDevice({ hostname: "build-box" });

    expect(pollPendingDevice(pending.pollToken)).toEqual({ status: "pending" });

    approvePendingDevice(pending.userCode);

    const result = pollPendingDevice(pending.pollToken);
    expect(result.status).toBe("approved");
    expect(result.status === "approved" && result.deviceKey).toMatch(/^dk_/);
  });

  it("hands the key over exactly once", async () => {
    const pending = createPendingDevice({ hostname: "build-box" });
    approvePendingDevice(pending.userCode);

    expect(pollPendingDevice(pending.pollToken).status).toBe("approved");
    expect(pollPendingDevice(pending.pollToken).status).toBe("expired");
  });

  it("names the device after the host that asked", async () => {
    const pending = createPendingDevice({ hostname: "build-box" });
    const device = approvePendingDevice(pending.userCode);
    expect(device?.name).toBe("build-box");
  });

  it("refuses a poll token that was never issued", async () => {
    expect(pollPendingDevice("bogus").status).toBe("expired");
  });

  it("does not approve an unknown code", async () => {
    expect(approvePendingDevice("ZZZZ-ZZZZ")).toBeNull();
  });

  it("drops a denied request", async () => {
    const pending = createPendingDevice({ hostname: "build-box" });
    expect(denyPendingDevice(pending.userCode)).toBe(true);
    expect(pollPendingDevice(pending.pollToken).status).toBe("expired");
    expect(listPendingDevices()).toHaveLength(0);
  });

  it("never stores the poll token in the clear", async () => {
    const pending = createPendingDevice({ hostname: "build-box" });
    expect(readStore()).not.toContain(pending.pollToken);
  });

  it("never writes the issued device key to disk, even before it is claimed", async () => {
    const pending = createPendingDevice({ hostname: "build-box" });
    approvePendingDevice(pending.userCode);

    // The key exists only in memory between approval and collection; store.json
    // must stay useless to anyone who reads it.
    const onDiskAfterApproval = readStore();

    const result = pollPendingDevice(pending.pollToken);
    expect(result.status).toBe("approved");
    const deviceKey = result.status === "approved" ? result.deviceKey : "";

    expect(deviceKey).toMatch(/^dk_/);
    expect(onDiskAfterApproval).not.toContain(deviceKey);
    expect(readStore()).not.toContain(deviceKey);
  });

  it("does not leak poll tokens to the admin listing", async () => {
    const pending = createPendingDevice({ hostname: "build-box" });
    expect(JSON.stringify(listPendingDevices())).not.toContain(pending.pollToken);
  });
});

describe("store file", () => {
  it("is not readable by other users on the host", async () => {
    createAuthKey({});
    const mode = fs.statSync(path.join(dataDir, "store.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
