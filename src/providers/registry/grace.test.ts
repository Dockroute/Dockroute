import { describe, expect, test } from "bun:test";
import { DeleteGrace } from "./grace";
import type { Plan, RegistryRecord } from "./planner";

const START = 1_700_000_000_000;
const PREFIX = "_dockroute-";

function rec(hostname: string, over: Partial<RegistryRecord> = {}): RegistryRecord {
  return { hostname, type: "A", content: "10.0.0.1", ttl: 300, ...over };
}

function plan(deletes: RegistryRecord[]): Plan {
  return { creates: [], updates: [], deletes, conflicts: [] };
}

function clock(start = START) {
  let now = start;
  return {
    now: () => now,
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
  };
}

const hostnames = (records: RegistryRecord[]) => records.map((r) => r.hostname);

describe("DeleteGrace", () => {
  test("defers a delete the first time the record goes missing", () => {
    const grace = new DeleteGrace(60, PREFIX, clock().now);
    const result = grace.apply(plan([rec("gone.example.com")]), "z1");

    expect(result.plan.deletes).toEqual([]);
    expect(hostnames(result.deferred)).toEqual(["gone.example.com"]);
  });

  test("executes the delete once the window has fully elapsed", () => {
    const time = clock();
    const grace = new DeleteGrace(60, PREFIX, time.now);

    grace.apply(plan([rec("gone.example.com")]), "z1");
    time.advance(59);
    expect(grace.apply(plan([rec("gone.example.com")]), "z1").plan.deletes).toEqual([]);

    time.advance(1);
    const result = grace.apply(plan([rec("gone.example.com")]), "z1");
    expect(hostnames(result.plan.deletes)).toEqual(["gone.example.com"]);
    expect(result.deferred).toEqual([]);
  });

  test("a record that reappears restarts the window from scratch", () => {
    const time = clock();
    const grace = new DeleteGrace(60, PREFIX, time.now);

    grace.apply(plan([rec("flapping.example.com")]), "z1");
    time.advance(59);
    grace.apply(plan([]), "z1"); // back in the desired state: no longer an orphan
    time.advance(59);

    expect(grace.apply(plan([rec("flapping.example.com")]), "z1").plan.deletes).toEqual([]);
  });

  test("a record and its ownership TXT leave the window together", () => {
    const time = clock();
    const grace = new DeleteGrace(60, PREFIX, time.now);
    const orphan = [rec("gone.example.com"), rec("_dockroute-a.gone.example.com", { type: "TXT" })];

    expect(grace.apply(plan(orphan), "z1").deferred).toHaveLength(2);
    time.advance(61);
    expect(grace.apply(plan(orphan), "z1").plan.deletes).toHaveLength(2);
  });

  test("a delete that failed at the provider is retried without a fresh window", () => {
    const time = clock();
    const grace = new DeleteGrace(60, PREFIX, time.now);

    grace.apply(plan([rec("gone.example.com")]), "z1");
    time.advance(61);
    grace.apply(plan([rec("gone.example.com")]), "z1"); // due, but the API call fails

    expect(grace.apply(plan([rec("gone.example.com")]), "z1").plan.deletes).toHaveLength(1);
  });

  test("windows are tracked per scope", () => {
    const time = clock();
    const grace = new DeleteGrace(60, PREFIX, time.now);

    grace.apply(plan([rec("gone.example.com")]), "z1");
    time.advance(61);

    expect(grace.apply(plan([rec("gone.example.com")]), "z2").plan.deletes).toEqual([]);
    expect(grace.apply(plan([rec("gone.example.com")]), "z1").plan.deletes).toHaveLength(1);
  });

  test("pruning one scope leaves the others untouched", () => {
    const time = clock();
    const grace = new DeleteGrace(60, PREFIX, time.now);

    grace.apply(plan([rec("gone.example.com")]), "z1");
    time.advance(61);
    grace.apply(plan([]), "z2"); // an unrelated zone with nothing to delete

    expect(grace.apply(plan([rec("gone.example.com")]), "z1").plan.deletes).toHaveLength(1);
  });

  test("a record whose hostname is still desired is deleted at once", () => {
    const grace = new DeleteGrace(60, PREFIX, clock().now);
    const result = grace.apply(
      plan([rec("switching.example.com")]),
      "z1",
      new Set(["switching.example.com"]),
    );

    expect(hostnames(result.plan.deletes)).toEqual(["switching.example.com"]);
    expect(result.deferred).toEqual([]);
  });

  test("a companion TXT leaves with the record it tracks, not on its own name", () => {
    const grace = new DeleteGrace(60, PREFIX, clock().now);
    const result = grace.apply(
      plan([
        rec("switching.example.com"),
        rec("_dockroute-a.switching.example.com", { type: "TXT" }),
      ]),
      "z1",
      new Set(["switching.example.com"]),
    );

    expect(hostnames(result.plan.deletes)).toEqual([
      "switching.example.com",
      "_dockroute-a.switching.example.com",
    ]);
    expect(result.deferred).toEqual([]);
  });

  test("a grace of zero passes the plan straight through", () => {
    const grace = new DeleteGrace(0, PREFIX, clock().now);
    const result = grace.apply(plan([rec("gone.example.com")]), "z1");

    expect(hostnames(result.plan.deletes)).toEqual(["gone.example.com"]);
    expect(result.deferred).toEqual([]);
  });

  test("creates, updates and conflicts are never touched", () => {
    const grace = new DeleteGrace(60, PREFIX, clock().now);
    const input: Plan = {
      creates: [rec("new.example.com")],
      updates: [rec("changed.example.com")],
      deletes: [rec("gone.example.com")],
      conflicts: [{ hostname: "theirs.example.com", type: "A", reason: "not ours" }],
    };

    const { plan: filtered } = grace.apply(input, "z1");
    expect(filtered.creates).toEqual(input.creates);
    expect(filtered.updates).toEqual(input.updates);
    expect(filtered.conflicts).toEqual(input.conflicts);
  });
});
