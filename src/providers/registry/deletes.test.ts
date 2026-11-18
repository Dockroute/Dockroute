import { describe, expect, test } from "bun:test";
import { txtDeletesSafeToRun } from "./deletes";
import type { RegistryRecord } from "./planner";

const PREFIX = "_dockroute-";

function rec(hostname: string, over: Partial<RegistryRecord> = {}): RegistryRecord {
  return { hostname, type: "A", content: "10.0.0.1", ttl: 300, ...over };
}

function txt(hostname: string, type = "a"): RegistryRecord {
  return rec(`${PREFIX}${type}.${hostname}`, { type: "TXT", content: "owner" });
}

const hostnames = (records: RegistryRecord[]) => records.map((r) => r.hostname);

describe("txtDeletesSafeToRun", () => {
  test("withholds the TXT of a data record whose delete failed", () => {
    const data = rec("gone.example.com");
    const deletes = [data, txt("gone.example.com")];

    const safe = txtDeletesSafeToRun(deletes, [data], PREFIX);

    expect(safe).toEqual([]);
  });

  test("returns the TXT of a data record whose delete succeeded", () => {
    const deletes = [rec("gone.example.com"), txt("gone.example.com")];

    const safe = txtDeletesSafeToRun(deletes, [], PREFIX);

    expect(hostnames(safe)).toEqual(["_dockroute-a.gone.example.com"]);
  });

  test("returns a dangling TXT that has no data record in the plan", () => {
    const deletes = [txt("dangling.example.com")];

    const safe = txtDeletesSafeToRun(deletes, [], PREFIX);

    expect(hostnames(safe)).toEqual(["_dockroute-a.dangling.example.com"]);
  });

  test("withholds only the TXT whose own data record failed", () => {
    const failedA = rec("both.example.com");
    const deletes = [
      failedA,
      rec("both.example.com", { type: "CNAME", content: "t.example" }),
      txt("both.example.com", "a"),
      txt("both.example.com", "cname"),
      rec("other.example.com"),
      txt("other.example.com"),
    ];

    const safe = txtDeletesSafeToRun(deletes, [failedA], PREFIX);

    expect(hostnames(safe)).toEqual([
      "_dockroute-cname.both.example.com",
      "_dockroute-a.other.example.com",
    ]);
  });

  test("never returns a data record", () => {
    const deletes = [rec("gone.example.com"), txt("gone.example.com")];

    const safe = txtDeletesSafeToRun(deletes, [], PREFIX);

    expect(safe.every((r) => r.type === "TXT")).toBe(true);
  });
});
