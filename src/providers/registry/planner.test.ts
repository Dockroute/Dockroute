import { describe, expect, test } from "bun:test";
import { formatOwnershipContent } from "./ownership";
import { type PlanInput, planChanges, type RegistryRecord } from "./planner";

const PREFIX = "_dockroute-";
const OWNER = "home-lab";

function rec(hostname: string, over: Partial<RegistryRecord> = {}): RegistryRecord {
  return { hostname, type: "A", content: "10.0.0.1", ttl: 300, ...over };
}

function ownedTxt(hostname: string, type = "a", owner = OWNER): RegistryRecord {
  return {
    hostname: `${PREFIX}${type}.${hostname}`,
    type: "TXT",
    content: formatOwnershipContent({ owner }),
    ttl: 300,
  };
}

function plan(input: Partial<PlanInput>) {
  return planChanges({
    desired: [],
    actual: [],
    ownerId: OWNER,
    txtPrefix: PREFIX,
    policy: "sync",
    ...input,
  });
}

describe("planChanges — creates", () => {
  test("new record is created together with its ownership TXT", () => {
    const p = plan({ desired: [rec("a.example.com", { resource: "container/whoami" })] });
    expect(p.creates).toEqual([
      rec("a.example.com", { resource: "container/whoami" }),
      {
        hostname: "_dockroute-a.a.example.com",
        type: "TXT",
        content: formatOwnershipContent({ owner: OWNER, resource: "container/whoami" }),
        ttl: 300,
      },
    ]);
    expect(p.updates).toEqual([]);
    expect(p.deletes).toEqual([]);
    expect(p.conflicts).toEqual([]);
  });

  test("dangling owned TXT: record is recreated without a duplicate TXT", () => {
    const p = plan({
      desired: [rec("a.example.com")],
      actual: [ownedTxt("a.example.com")],
    });
    expect(p.creates).toEqual([rec("a.example.com")]);
    expect(p.deletes).toEqual([]);
  });
});

describe("planChanges — updates", () => {
  test("updates only when content, ttl or provider hints differ", () => {
    const unchanged = plan({
      desired: [rec("a.example.com")],
      actual: [rec("a.example.com"), ownedTxt("a.example.com")],
    });
    expect(unchanged.updates).toEqual([]);
    expect(unchanged.creates).toEqual([]);

    const changed = plan({
      desired: [rec("a.example.com", { content: "10.0.0.2" })],
      actual: [rec("a.example.com"), ownedTxt("a.example.com")],
    });
    expect(changed.updates).toEqual([rec("a.example.com", { content: "10.0.0.2" })]);

    const hintChanged = plan({
      desired: [rec("a.example.com", { providerSpecific: { "cloudflare.proxied": "true" } })],
      actual: [
        rec("a.example.com", { providerSpecific: { "cloudflare.proxied": "false" } }),
        ownedTxt("a.example.com"),
      ],
    });
    expect(hintChanged.updates).toHaveLength(1);
  });
});

describe("planChanges — conflicts (never touch what we do not own)", () => {
  test.each(["sync", "upsert-only", "create-only"] as const)(
    "existing record without ownership TXT is a conflict under %s",
    (policy) => {
      const p = plan({
        policy,
        desired: [rec("a.example.com", { content: "10.9.9.9" })],
        actual: [rec("a.example.com")],
      });
      expect(p.conflicts).toHaveLength(1);
      expect(p.creates).toEqual([]);
      expect(p.updates).toEqual([]);
      expect(p.deletes).toEqual([]);
    },
  );

  test("record owned by another instance is a conflict", () => {
    const p = plan({
      desired: [rec("a.example.com", { content: "10.9.9.9" })],
      actual: [rec("a.example.com"), ownedTxt("a.example.com", "a", "other-instance")],
    });
    expect(p.conflicts[0]?.reason).toContain("other-instance");
    expect(p.updates).toEqual([]);
    expect(p.deletes).toEqual([]);
  });

  test("dangling foreign TXT blocks creation", () => {
    const p = plan({
      desired: [rec("a.example.com")],
      actual: [ownedTxt("a.example.com", "a", "other-instance")],
    });
    expect(p.creates).toEqual([]);
    expect(p.conflicts).toHaveLength(1);
  });

  test("foreign-owned orphans are never deleted", () => {
    const p = plan({
      actual: [rec("a.example.com"), ownedTxt("a.example.com", "a", "other-instance")],
    });
    expect(p.deletes).toEqual([]);
  });
});

describe("planChanges — policies and orphans", () => {
  const orphanActual = [rec("gone.example.com"), ownedTxt("gone.example.com")];

  test("sync deletes owned orphans together with their TXT", () => {
    const p = plan({ actual: orphanActual });
    expect(p.deletes).toEqual(orphanActual);
  });

  test("sync cleans up dangling owned TXT when the hostname is no longer desired", () => {
    const p = plan({ actual: [ownedTxt("gone.example.com")] });
    expect(p.deletes).toEqual([ownedTxt("gone.example.com")]);
  });

  test("upsert-only never deletes", () => {
    const p = plan({ policy: "upsert-only", actual: orphanActual });
    expect(p.deletes).toEqual([]);
  });

  test("upsert-only still updates owned records", () => {
    const p = plan({
      policy: "upsert-only",
      desired: [rec("a.example.com", { content: "10.0.0.2" })],
      actual: [rec("a.example.com"), ownedTxt("a.example.com")],
    });
    expect(p.updates).toHaveLength(1);
  });

  test("create-only never updates nor deletes", () => {
    const p = plan({
      policy: "create-only",
      desired: [rec("a.example.com", { content: "10.0.0.2" }), rec("new.example.com")],
      actual: [rec("a.example.com"), ownedTxt("a.example.com"), ...orphanActual],
    });
    expect(p.updates).toEqual([]);
    expect(p.deletes).toEqual([]);
    expect(p.creates.map((r) => r.hostname)).toEqual([
      "new.example.com",
      "_dockroute-a.new.example.com",
    ]);
  });

  test("same hostname with different record types is tracked independently", () => {
    const p = plan({
      desired: [rec("a.example.com"), rec("a.example.com", { type: "AAAA", content: "::1" })],
      actual: [rec("a.example.com"), ownedTxt("a.example.com")],
    });
    expect(p.creates.map((r) => r.hostname)).toEqual([
      "a.example.com",
      "_dockroute-aaaa.a.example.com",
    ]);
    expect(p.updates).toEqual([]);
  });
});
