import pkg from "../package.json";

const REPO_URL = "https://github.com/Dockroute/Dockroute";

/**
 * Logs a single line pointing at the project repo. Call it once at process
 * start, never from the reconcile loop: repeating it would spam the logs.
 * No network, no telemetry; it only prints.
 */
export function logStartupBanner(
  log: (line: string) => void = console.log,
  version: string = pkg.version,
): void {
  log(`DockRoute v${version} · ${REPO_URL} · ⭐ Star us if it saves you time`);
}
