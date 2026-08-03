import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Reconciler } from "../core/reconciler";
import type { DockerClient } from "./client";
import { Watcher } from "./watcher";

const RESYNC_SECONDS = 3600;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeReconciler(): { reconciler: Reconciler; calls: { count: number } } {
  const calls = { count: 0 };
  const reconciler = {
    reconcile: async () => {
      calls.count++;
    },
  } as unknown as Reconciler;
  return { reconciler, calls };
}

/**
 * DockerClient whose event stream follows a script, one entry per connection:
 * "timeout" / "error" throw on subscribe, "hang" stays open with no events.
 */
function scriptedDocker(
  script: Array<"timeout" | "error" | "hang">,
  onConnect: (connection: number) => void,
): DockerClient {
  let connection = 0;
  return {
    async *containerEvents() {
      const step = script[Math.min(connection, script.length - 1)];
      connection++;
      onConnect(connection);
      if (step === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
      if (step === "error") throw new Error("boom");
      await new Promise(() => {});
    },
  } as unknown as DockerClient;
}

describe("Watcher", () => {
  let watcher: Watcher | undefined;
  let errorSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    watcher?.stop();
    errorSpy?.mockRestore();
  });

  test("timeout is a routine reconnect: immediate, silent, with a catch-up reconcile", async () => {
    const { reconciler, calls } = fakeReconciler();
    const reconnected = deferred();
    const docker = scriptedDocker(["timeout", "hang"], (connection) => {
      if (connection === 2) reconnected.resolve();
    });
    errorSpy = spyOn(console, "error").mockImplementation(() => {});

    // A huge retryMs proves the reconnect did not wait for the retry delay.
    watcher = new Watcher(docker, reconciler, RESYNC_SECONDS, 60_000);
    await watcher.start();
    await reconnected.promise;

    expect(calls.count).toBe(2); // startup reconcile + catch-up after the drop
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("real errors log a single line and retry after the delay", async () => {
    const { reconciler } = fakeReconciler();
    const reconnected = deferred();
    const docker = scriptedDocker(["error", "hang"], (connection) => {
      if (connection === 2) reconnected.resolve();
    });
    errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const started = performance.now();
    watcher = new Watcher(docker, reconciler, RESYNC_SECONDS, 25);
    await watcher.start();
    await reconnected.promise;

    expect(performance.now() - started).toBeGreaterThanOrEqual(20);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const args = errorSpy.mock.calls[0] as unknown[];
    expect(args).toHaveLength(1); // one formatted string, not the raw error object
    expect(String(args[0])).toContain("Error: boom");
  });
});
