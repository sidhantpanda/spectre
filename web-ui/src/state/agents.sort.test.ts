import { describe, expect, it } from "vitest";
import { sortAgents, type Agent } from "./agents";

function agent(hostname: string, lastSeen: number, id = hostname, lastConnectedAt?: number): Agent {
  return {
    id,
    connectionId: id,
    address: "10.0.0.1:1",
    status: "connected",
    lastSeen,
    lastConnectedAt,
    fingerprint: { hostname, macAddresses: [], nics: [] },
  };
}

const names = (list: Agent[]) => list.map((a) => a.fingerprint!.hostname);

describe("sortAgents", () => {
  const agents = [agent("nuc-2", 300), agent("alpha", 100), agent("Beta", 200)];

  it("sorts by name, case-insensitively", () => {
    expect(names(sortAgents(agents, "name-asc"))).toEqual(["alpha", "Beta", "nuc-2"]);
  });

  it("reverses the name order", () => {
    expect(names(sortAgents(agents, "name-desc"))).toEqual(["nuc-2", "Beta", "alpha"]);
  });

  it("falls back to the device id when a machine reports no hostname", () => {
    const anonymous: Agent = {
      id: "zz-id",
      connectionId: "zz-id",
      address: "10.0.0.9:1",
      status: "disconnected",
      lastSeen: 1,
    };
    expect(sortAgents([anonymous, agent("alpha", 2)], "name-asc")[0].id).toBe("alpha");
  });

  describe("by last connected", () => {
    // opened recently, opened a while ago, never opened
    const opened = [
      agent("zulu", 1, "zulu", 900),
      agent("alpha", 2, "alpha", 100),
      agent("mike", 3, "mike", undefined),
    ];

    it("puts the most recently connected first", () => {
      expect(names(sortAgents(opened, "last-connected-desc"))).toEqual(["zulu", "alpha", "mike"]);
    });

    it("puts the earliest connected first", () => {
      expect(names(sortAgents(opened, "last-connected-asc"))).toEqual(["alpha", "zulu", "mike"]);
    });

    it("keeps never-connected machines last in both directions", () => {
      expect(names(sortAgents(opened, "last-connected-desc")).at(-1)).toBe("mike");
      expect(names(sortAgents(opened, "last-connected-asc")).at(-1)).toBe("mike");
    });

    it("orders several never-connected machines by name", () => {
      const none = [agent("zulu", 1), agent("alpha", 2), agent("mike", 3)];
      expect(names(sortAgents(none, "last-connected-desc"))).toEqual(["alpha", "mike", "zulu"]);
    });

    it("breaks ties by name", () => {
      const tied = [agent("zulu", 1, "zulu", 500), agent("alpha", 2, "alpha", 500)];
      expect(names(sortAgents(tied, "last-connected-desc"))).toEqual(["alpha", "zulu"]);
    });
  });

  it("does not mutate the array it is given", () => {
    const input = [agent("zulu", 1), agent("alpha", 2)];
    sortAgents(input, "name-asc");
    expect(names(input)).toEqual(["zulu", "alpha"]);
  });
});
