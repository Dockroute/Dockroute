import { heartbeatPath } from "./health";

/**
 * `HEALTHCHECK` entrypoint (see Dockerfile). Exits 0 while the reconcile
 * loop has touched the heartbeat file recently, non-zero otherwise so Docker
 * (and orchestrators reading its status) can flag/restart a stuck container.
 *
 * The staleness budget is derived from DOCKROUTE_RESYNC_SECONDS: the loop is
 * expected to reconcile at least that often, plus slack for a slow provider
 * call and the ~30s Docker gives a single HEALTHCHECK probe to run.
 */

const DEFAULT_RESYNC_SECONDS = 60;
const STALE_MULTIPLIER = 3;
const MIN_STALE_MS = 90_000;

function staleAfterMs(env = process.env): number {
  const resyncSeconds = Number(env.DOCKROUTE_RESYNC_SECONDS) || DEFAULT_RESYNC_SECONDS;
  return Math.max(resyncSeconds * 1000 * STALE_MULTIPLIER, MIN_STALE_MS);
}

export async function checkHealth(path = heartbeatPath()): Promise<number> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    console.error(`[healthcheck] ${path} does not exist yet (still starting?)`);
    return 1;
  }

  const raw = await file.text();
  const lastBeat = Number(raw);
  if (!Number.isFinite(lastBeat)) {
    console.error(`[healthcheck] ${path} content is not a valid timestamp: ${raw}`);
    return 1;
  }

  const age = Date.now() - lastBeat;
  const budget = staleAfterMs();
  if (age > budget) {
    console.error(
      `[healthcheck] heartbeat is ${Math.round(age / 1000)}s old (budget ${Math.round(budget / 1000)}s)`,
    );
    return 1;
  }

  return 0;
}

if (import.meta.main) {
  process.exit(await checkHealth());
}
