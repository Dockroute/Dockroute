import { describe, expect, test } from "bun:test";
import {
  formatOwnershipContent,
  parseOwnershipContent,
  parseTxtName,
  txtNameFor,
} from "./ownership";

const PREFIX = "_dockroute-";

describe("ownership content", () => {
  test("format/parse round-trip", () => {
    const content = formatOwnershipContent({ owner: "home-lab", resource: "container/whoami" });
    expect(content).toBe(
      "heritage=dockroute,dockroute/owner=home-lab,dockroute/resource=container/whoami",
    );
    expect(parseOwnershipContent(content)).toEqual({
      owner: "home-lab",
      resource: "container/whoami",
    });
  });

  test("resource is optional", () => {
    const content = formatOwnershipContent({ owner: "default" });
    expect(parseOwnershipContent(content)).toEqual({ owner: "default", resource: undefined });
  });

  test("parses provider-quoted content", () => {
    expect(parseOwnershipContent('"heritage=dockroute,dockroute/owner=x"')?.owner).toBe("x");
  });

  test("rejects foreign heritage and unrelated TXT content", () => {
    expect(parseOwnershipContent("heritage=external-dns,external-dns/owner=x")).toBeUndefined();
    expect(parseOwnershipContent("v=spf1 include:_spf.google.com ~all")).toBeUndefined();
    expect(parseOwnershipContent("heritage=dockroute")).toBeUndefined();
  });
});

describe("txt naming", () => {
  test("name round-trips for every record type", () => {
    for (const type of ["A", "AAAA", "CNAME"] as const) {
      const name = txtNameFor("whoami.example.com", type, PREFIX);
      expect(name).toBe(`${PREFIX}${type.toLowerCase()}.whoami.example.com`);
      expect(parseTxtName(name, PREFIX)).toEqual({ hostname: "whoami.example.com", type });
    }
  });

  test("round-trips for apex hostnames", () => {
    const name = txtNameFor("example.com", "A", PREFIX);
    expect(parseTxtName(name, PREFIX)).toEqual({ hostname: "example.com", type: "A" });
  });

  test("rejects non-registry TXT names", () => {
    expect(parseTxtName("whoami.example.com", PREFIX)).toBeUndefined();
    expect(parseTxtName("_dmarc.example.com", PREFIX)).toBeUndefined();
    expect(parseTxtName(`${PREFIX}mx.example.com`, PREFIX)).toBeUndefined();
    expect(parseTxtName(`${PREFIX}a`, PREFIX)).toBeUndefined();
  });
});
