import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRYPOINT = join(import.meta.dir, "..", "docker-entrypoint.sh");
const CPUINFO = join(import.meta.dir, "..", "test", "fixtures", "cpuinfo");
const MODERN_CPU = join(CPUINFO, "host-alder-lake.txt");

let dir: string;
let fakeBin: string;
let socketPath: string;
let socketGid: number;
let listener: { stop(): void };

function fakeCommand(name: string, body: string) {
  const path = join(fakeBin, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

/**
 * Runs the entrypoint as if root, with `setpriv` faked to print how it was asked to drop
 * privileges. The CPU defaults to a modern one so the host running the tests does not matter.
 */
function spawnEntrypoint(env: Record<string, string>, uid = "0") {
  fakeCommand("id", `echo ${uid}`);
  const startedAt = performance.now();
  const result = Bun.spawnSync(["sh", ENTRYPOINT, "echo", "app"], {
    env: { PATH: `${fakeBin}:${process.env.PATH}`, DOCKROUTE_CPUINFO: MODERN_CPU, ...env },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    elapsedMs: performance.now() - startedAt,
  };
}

function runEntrypoint(env: Record<string, string>, uid = "0"): string {
  return spawnEntrypoint(env, uid).stdout;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dockroute-entrypoint-"));
  fakeBin = join(dir, "bin");
  mkdirSync(fakeBin);
  fakeCommand("setpriv", 'echo "setpriv $*"');
  socketPath = join(dir, "docker.sock");
  listener = Bun.listen({ unix: socketPath, socket: { data() {} } });
  socketGid = statSync(socketPath).gid;
});

afterAll(() => {
  listener.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("docker-entrypoint.sh", () => {
  test("grants the socket's group when DOCKER_HOST is unset", () => {
    const output = runEntrypoint({ DOCKER_SOCK: socketPath });

    expect(output).toBe(`setpriv --reuid bun --regid bun --groups ${socketGid} -- echo app`);
  });

  test("treats a blank DOCKER_HOST as unset, like the app", () => {
    const output = runEntrypoint({ DOCKER_HOST: "  ", DOCKER_SOCK: socketPath });

    expect(output).toContain(`--groups ${socketGid}`);
  });

  test("grants the group of a unix:// DOCKER_HOST socket, ignoring surrounding whitespace", () => {
    const output = runEntrypoint({ DOCKER_HOST: ` unix://${socketPath} ` });

    expect(output).toContain(`--groups ${socketGid}`);
  });

  test("never grants the socket's group in tcp mode, even with a socket mounted", () => {
    for (const host of ["tcp://socket-proxy:2375", " tcp://socket-proxy:2375"]) {
      const output = runEntrypoint({ DOCKER_HOST: host, DOCKER_SOCK: socketPath });

      expect(output).toBe("setpriv --reuid bun --regid bun --clear-groups -- echo app");
    }
  });

  test("fails closed for a DOCKER_HOST it does not recognise", () => {
    const output = runEntrypoint({ DOCKER_HOST: "ssh://user@host", DOCKER_SOCK: socketPath });

    expect(output).toContain("--clear-groups");
  });

  test("passes straight through when not started as root", () => {
    const output = runEntrypoint({ DOCKER_SOCK: socketPath }, "1000");

    expect(output).toBe("app");
  });
});

describe("docker-entrypoint.sh CPU preflight", () => {
  test("refuses to start on a QEMU kvm64 CPU, which hides SSE4.2 and POPCNT", () => {
    const result = spawnEntrypoint({ DOCKROUTE_CPUINFO: join(CPUINFO, "qemu-kvm64.txt") });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("sse4_2 popcnt");
    expect(result.stderr).toContain('CPU type to "host"');
    expect(result.elapsedMs).toBeLessThan(1000);
  });

  test("refuses to start when only POPCNT is missing", () => {
    const cpuinfo = join(dir, "no-popcnt.txt");
    writeFileSync(cpuinfo, readFileSync(MODERN_CPU, "utf8").replace(" popcnt ", " "));

    const result = spawnEntrypoint({ DOCKROUTE_CPUINFO: cpuinfo });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("missing popcnt");
    expect(result.stderr).toContain('CPU type to "host"');
    expect(result.elapsedMs).toBeLessThan(1000);
  });

  test("also refuses to start when not started as root", () => {
    const result = spawnEntrypoint({ DOCKROUTE_CPUINFO: join(CPUINFO, "qemu-kvm64.txt") }, "1000");

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
  });

  test("starts the app on a CPU with SSE4.2 and POPCNT", () => {
    const result = spawnEntrypoint({ DOCKER_SOCK: socketPath });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("-- echo app");
  });

  test("skips the check where cpuinfo has no x86 flags line, such as arm64", () => {
    const result = spawnEntrypoint({ DOCKROUTE_CPUINFO: join(CPUINFO, "arm64.txt") }, "1000");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("app");
  });

  test("skips the check when cpuinfo cannot be read", () => {
    const result = spawnEntrypoint({ DOCKROUTE_CPUINFO: join(dir, "missing") }, "1000");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("app");
  });
});
