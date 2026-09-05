/**
 * Liveness heartbeat: the reconcile loop touches this file after every
 * successful reconcile, and `src/healthcheck.ts` (invoked by the Dockerfile's
 * `HEALTHCHECK`) checks how stale it is. This proves the *whole* pipeline is
 * alive (Docker socket reachable, provider sync succeeding) rather than just
 * "the process didn't crash".
 */

export const DEFAULT_HEARTBEAT_PATH = "/tmp/dockroute-heartbeat";

export function heartbeatPath(env = process.env): string {
  return env.DOCKROUTE_HEARTBEAT_PATH ?? DEFAULT_HEARTBEAT_PATH;
}

/** Writes the current time to the heartbeat file. Call after each successful reconcile. */
export async function touchHeartbeat(path = heartbeatPath()): Promise<void> {
  await Bun.write(path, String(Date.now()));
}
