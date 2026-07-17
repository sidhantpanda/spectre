import type { NetworkInterfaceInfo } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";

// Controls what os.networkInterfaces() returns for each test.
let mockInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {};

vi.mock("os", async (importActual) => {
  const actual = await importActual<typeof import("os")>();
  return {
    ...actual,
    networkInterfaces: () => mockInterfaces,
  };
});

// Imported after vi.mock so it binds to the mocked module.
const { lanAddresses, primaryHostAddress } = await import("./net");

function iface(address: string, extra: Partial<NetworkInterfaceInfo> = {}): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: `${address}/24`,
    ...extra,
  } as NetworkInterfaceInfo;
}

afterEach(() => {
  mockInterfaces = {};
});

describe("lanAddresses", () => {
  it("excludes loopback, link-local, and IPv6", () => {
    mockInterfaces = {
      lo0: [iface("127.0.0.1", { internal: true })],
      en0: [iface("192.168.1.50"), iface("fe80::1", { family: "IPv6" })],
      en1: [iface("169.254.10.10")],
    };

    expect(lanAddresses()).toEqual(["192.168.1.50"]);
  });

  it("ranks private LAN ranges ahead of other routable addresses", () => {
    mockInterfaces = {
      eth0: [iface("172.20.0.5")],
      eth1: [iface("10.1.2.3")],
      eth2: [iface("192.168.0.9")],
      eth3: [iface("100.64.0.1")], // CGNAT / other routable
    };

    // 192.168 > 10.x > 172.16/12 > everything else.
    expect(lanAddresses()).toEqual(["192.168.0.9", "10.1.2.3", "172.20.0.5", "100.64.0.1"]);
  });

  it("does not treat 172.x outside the private block as private", () => {
    mockInterfaces = {
      eth0: [iface("172.15.0.1")], // just below the 172.16/12 block
      eth1: [iface("10.0.0.1")],
    };

    // 172.15 is public, so the 10.x address must rank ahead of it.
    expect(lanAddresses()).toEqual(["10.0.0.1", "172.15.0.1"]);
  });

  it("accepts the numeric family shape from newer Node", () => {
    mockInterfaces = {
      en0: [iface("192.168.5.5", { family: 4 as unknown as "IPv4" })],
    };

    expect(lanAddresses()).toEqual(["192.168.5.5"]);
  });

  it("falls back to localhost when there is no usable address", () => {
    mockInterfaces = {
      lo0: [iface("127.0.0.1", { internal: true })],
    };

    expect(lanAddresses()).toEqual([]);
    expect(primaryHostAddress()).toBe("localhost");
  });
});
