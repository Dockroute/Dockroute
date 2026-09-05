import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { touchHeartbeat } from "./health";

describe("touchHeartbeat", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  test("writes a numeric timestamp close to now", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dockroute-health-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "heartbeat");

    const before = Date.now();
    await touchHeartbeat(path);
    const after = Date.now();

    const raw = await Bun.file(path).text();
    const value = Number(raw);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });

  test("overwrites the file on repeated calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dockroute-health-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "heartbeat");

    await touchHeartbeat(path);
    const first = Number(await Bun.file(path).text());
    await Bun.sleep(2);
    await touchHeartbeat(path);
    const second = Number(await Bun.file(path).text());

    expect(second).toBeGreaterThanOrEqual(first);
  });
});
