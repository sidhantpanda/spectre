import { describe, expect, it } from "vitest";
import { sortAgents, type Agent } from "./agents";

function agent(hostname: string, lastSeen: number, id = hostname): Agent {
  return {
    id,
    connectionId: id,
    address: "10.0.0.1:1",
    status: "connected",
    lastSeen,
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

  it("puts the most recently seen first", () => {
    expect(names(sortAgents(agents, "last-seen-desc"))).toEqual(["nuc-2", "Beta", "alpha"]);
  });

  it("puts the earliest seen first", () => {
    expect(names(sortAgents(agents, "last-seen-asc"))).toEqual(["alpha", "Beta", "nuc-2"]);
  });

  it("breaks lastSeen ties by name so the order is stable", () => {
    const tied = [agent("zulu", 500), agent("alpha", 500), agent("mike", 500)];
    expect(names(sortAgents(tied, "last-seen-desc"))).toEqual(["alpha", "mike", "zulu"]);
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

  it("does not mutate the array it is given", () => {
    const input = [agent("zulu", 1), agent("alpha", 2)];
    sortAgents(input, "name-asc");
    expect(names(input)).toEqual(["zulu", "alpha"]);
  });
});
