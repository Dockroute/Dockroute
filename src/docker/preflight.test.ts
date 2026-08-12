import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnoseSocketAccess } from "./preflight";

describe("diagnoseSocketAccess", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dockroute-preflight-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    return dir;
  }

  function listen(path: string): void {
    const server = Bun.listen({ unix: path, socket: { data() {} } });
    cleanups.push(() => server.stop(true));
  }

  test("explains how to mount the socket when the path does not exist", async () => {
    const message = await diagnoseSocketAccess(join(await tempDir(), "missing.sock"));

    expect(message).toContain("not found");
    expect(message).toContain("-v /var/run/docker.sock");
  });

  test("flags a non-socket path as a broken bind mount", async () => {
    const path = join(await tempDir(), "docker.sock");
    await writeFile(path, "");

    const message = await diagnoseSocketAccess(path);

    expect(message).toContain("not a unix socket");
  });

  // Root bypasses file permissions, so this diagnosis is untestable as uid 0.
  test.skipIf(process.getuid?.() === 0)(
    "explains the group fix when the socket is unreadable",
    async () => {
      const path = join(await tempDir(), "docker.sock");
      listen(path);
      await chmod(path, 0o000);

      const message = await diagnoseSocketAccess(path);

      expect(message).toContain("Permission denied");
      expect(message).toContain("group_add");
    },
  );

  test("returns null for a readable socket", async () => {
    const path = join(await tempDir(), "docker.sock");
    listen(path);

    expect(await diagnoseSocketAccess(path)).toBeNull();
  });
});
