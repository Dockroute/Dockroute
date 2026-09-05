import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkHealth } from "./healthcheck";

describe("checkHealth", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
    delete process.env.DOCKROUTE_RESYNC_SECONDS;
  });

  async function tempPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dockroute-healthcheck-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    return join(dir, "heartbeat");
  }

  test("fails when the heartbeat file does not exist", async () => {
    const path = await tempPath();
    expect(await checkHealth(path)).toBe(1);
  });

  test("fails when the heartbeat content is not a number", async () => {
    const path = await tempPath();
    await writeFile(path, "not-a-timestamp");
    expect(await checkHealth(path)).toBe(1);
  });

  test("passes for a fresh heartbeat", async () => {
    const path = await tempPath();
    await writeFile(path, String(Date.now()));
    expect(await checkHealth(path)).toBe(0);
  });

  test("fails for a stale heartbeat beyond the default budget", async () => {
    const path = await tempPath();
    // default budget = 3 * 60s resync = 180s
    await writeFile(path, String(Date.now() - 181_000));
    expect(await checkHealth(path)).toBe(1);
  });

  test("respects the 90s floor even with a tiny resync interval", async () => {
    process.env.DOCKROUTE_RESYNC_SECONDS = "1"; // budget floors at 90s, not 3s
    const path = await tempPath();
    await writeFile(path, String(Date.now() - 5_000));
    expect(await checkHealth(path)).toBe(0);
  });

  test("respects a wider budget derived from DOCKROUTE_RESYNC_SECONDS", async () => {
    process.env.DOCKROUTE_RESYNC_SECONDS = "120"; // budget = 360s
    const path = await tempPath();
    await writeFile(path, String(Date.now() - 91_000));
    expect(await checkHealth(path)).toBe(0);
  });
});
