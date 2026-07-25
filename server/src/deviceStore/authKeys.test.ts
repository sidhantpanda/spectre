import { describe, expect, it } from "vitest";
import { createAuthKey, findDeviceByKey, listAuthKeys, redeemAuthKey, revokeAuthKey } from "./index";
import { dbBytes, setupStoreTest } from "./testStore";

setupStoreTest();

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
