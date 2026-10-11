import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRYPOINT = join(import.meta.dir, "..", "docker-entrypoint.sh");

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

/** Runs the entrypoint as if root, with `setpriv` faked to print how it was asked to drop privileges. */
function runEntrypoint(env: Record<string, string>, uid = "0"): string {
  fakeCommand("id", `echo ${uid}`);
  const result = Bun.spawnSync(["sh", ENTRYPOINT, "echo", "app"], {
    env: { PATH: `${fakeBin}:${process.env.PATH}`, ...env },
  });
  return result.stdout.toString().trim();
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
