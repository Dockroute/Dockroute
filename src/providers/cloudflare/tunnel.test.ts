import { describe, expect, test } from "bun:test";
import type { CfIngressRule } from "./api";
import { mergeIngress, type MergeIngressInput } from "./tunnel";

const CATCH_ALL: CfIngressRule = { service: "http_status:404" };

function merge(input: Partial<MergeIngressInput>) {
  return mergeIngress({
    current: [],
    desired: [],
    managedHostnames: new Set(),
    policy: "sync",
    ...input,
  });
}

describe("mergeIngress", () => {
  test("adds managed rules and a catch-all to an empty ingress", () => {
    const result = merge({
      desired: [{ hostname: "a.example.com", service: "http://a:80" }],
      managedHostnames: new Set(["a.example.com"]),
    });
    expect(result.changed).toBe(true);
    expect(result.ingress).toEqual([
      { hostname: "a.example.com", service: "http://a:80" },
      CATCH_ALL,
    ]);
  });

  test("leaves a tunnel it has no business with untouched", () => {
    const foreign = [{ hostname: "other.example.com", service: "http://other:80" }, CATCH_ALL];
    expect(merge({ current: [] }).changed).toBe(false);
    const result = merge({ current: foreign });
    expect(result.changed).toBe(false);
    expect(result.ingress).toEqual(foreign);
  });

  test("preserves unmanaged rules in original order, before managed ones", () => {
    const result = merge({
      current: [
        { hostname: "keep.example.com", service: "http://keep:80" },
        { hostname: "old.example.com", service: "http://old:80" },
        CATCH_ALL,
      ],
      desired: [
        { hostname: "z.example.com", service: "http://z:80" },
        { hostname: "old.example.com", service: "http://new:80" },
      ],
      managedHostnames: new Set(["old.example.com", "z.example.com"]),
    });
    expect(result.ingress).toEqual([
      { hostname: "keep.example.com", service: "http://keep:80" },
      { hostname: "old.example.com", service: "http://new:80" },
      { hostname: "z.example.com", service: "http://z:80" },
      CATCH_ALL,
    ]);
  });

  test("an unmanaged rule claiming a desired hostname is a conflict", () => {
    const current = [{ hostname: "a.example.com", service: "http://theirs:80" }, CATCH_ALL];
    const result = merge({
      current,
      desired: [{ hostname: "a.example.com", service: "http://ours:80" }],
      managedHostnames: new Set(), // not owned by us
    });
    expect(result.conflicts).toEqual(["a.example.com"]);
    expect(result.changed).toBe(false);
    expect(result.ingress).toEqual(current);
  });

  test("preserves extra settings when updating a managed rule", () => {
    const result = merge({
      current: [
        { hostname: "a.example.com", service: "http://old:80", originRequest: { noTLSVerify: true } },
        CATCH_ALL,
      ],
      desired: [{ hostname: "a.example.com", service: "http://new:80" }],
      managedHostnames: new Set(["a.example.com"]),
    });
    expect(result.ingress[0]).toEqual({
      hostname: "a.example.com",
      service: "http://new:80",
      originRequest: { noTLSVerify: true },
    });
  });

  test("sync removes orphaned managed rules", () => {
    const result = merge({
      current: [{ hostname: "gone.example.com", service: "http://gone:80" }, CATCH_ALL],
      managedHostnames: new Set(["gone.example.com"]),
    });
    expect(result.changed).toBe(true);
    expect(result.ingress).toEqual([CATCH_ALL]);
  });

  test("upsert-only keeps orphaned managed rules", () => {
    const current = [{ hostname: "gone.example.com", service: "http://gone:80" }, CATCH_ALL];
    const result = merge({
      policy: "upsert-only",
      current,
      managedHostnames: new Set(["gone.example.com"]),
    });
    expect(result.changed).toBe(false);
    expect(result.ingress).toEqual(current);
  });

  test("create-only never updates an existing managed rule", () => {
    const result = merge({
      policy: "create-only",
      current: [{ hostname: "a.example.com", service: "http://old:80" }, CATCH_ALL],
      desired: [
        { hostname: "a.example.com", service: "http://new:80" },
        { hostname: "b.example.com", service: "http://b:80" },
      ],
      managedHostnames: new Set(["a.example.com", "b.example.com"]),
    });
    expect(result.ingress).toEqual([
      { hostname: "a.example.com", service: "http://old:80" },
      { hostname: "b.example.com", service: "http://b:80" },
      CATCH_ALL,
    ]);
  });

  test("reports no change when the merged ingress is identical", () => {
    const current = [{ hostname: "a.example.com", service: "http://a:80" }, CATCH_ALL];
    const result = merge({
      current,
      desired: [{ hostname: "a.example.com", service: "http://a:80" }],
      managedHostnames: new Set(["a.example.com"]),
    });
    expect(result.changed).toBe(false);
  });
});
