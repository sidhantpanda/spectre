import { describe, expect, it } from "vitest";
import { publishedPorts } from "./format";

describe("publishedPorts", () => {
  it("collapses the bindings docker reports for one service to its host port", () => {
    expect(
      publishedPorts([
        "0.0.0.0:53->53/tcp",
        "[::]:53->53/tcp",
        "0.0.0.0:53->53/udp",
        "[::]:53->53/udp",
      ]),
    ).toEqual(["53"]);
  });

  it("orders host ports numerically, not as text", () => {
    expect(publishedPorts(["0.0.0.0:8853->8853/tcp", "0.0.0.0:80->80/tcp", "0.0.0.0:443->443/tcp"])).toEqual([
      "80",
      "443",
      "8853",
    ]);
  });

  it("reports the host port when it differs from the container port", () => {
    expect(publishedPorts(["0.0.0.0:8080->80/tcp"])).toEqual(["8080"]);
  });

  it("keeps a published range as one entry", () => {
    expect(publishedPorts(["0.0.0.0:8000-8002->8000-8002/tcp"])).toEqual(["8000-8002"]);
  });

  it("drops ports the image exposes but never publishes to the host", () => {
    expect(publishedPorts(["3000/udp", "6060/tcp", "67-68/udp"])).toEqual([]);
  });

  it("handles a container with no ports at all", () => {
    expect(publishedPorts()).toEqual([]);
    expect(publishedPorts([])).toEqual([]);
  });
});
