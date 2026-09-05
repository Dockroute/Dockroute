import type { DockerClient } from "../docker/client";
import { touchHeartbeat } from "../health";
import type { Provider } from "../providers/provider";
import { desiredFromContainer, type ParseOptions } from "./labels";
import type { DesiredState, DnsRecord, TunnelRoute } from "./types";

/**
 * Recomputes the full desired state from all running containers and hands it
 * to the provider. Serialized: if a reconcile is already running, the request
 * is coalesced into one follow-up run.
 */
export class Reconciler {
  private running = false;
  private pending = false;

  constructor(
    private docker: DockerClient,
    private provider: Provider,
    private parseOpts: ParseOptions,
  ) {}

  async reconcile(): Promise<void> {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.pending = false;
        const containers = await this.docker.listRunningContainers();
        const perContainer = containers.map((c) => desiredFromContainer(c, this.parseOpts));
        await this.provider.sync(mergeDesired(perContainer));
        await touchHeartbeat();
      } while (this.pending);
    } catch (err) {
      console.error("[reconciler] reconcile failed:", err);
    } finally {
      this.running = false;
    }
  }
}

/**
 * Merges per-container states and dedupes: a hostname may be claimed once per
 * record type, and once across all tunnel routes (first container wins).
 * A hostname claimed by a tunnel route also cannot be claimed as a record.
 */
export function mergeDesired(states: DesiredState[]): DesiredState {
  const records: DnsRecord[] = [];
  const tunnelRoutes: TunnelRoute[] = [];
  const seen = new Set<string>();

  for (const state of states) {
    for (const route of state.tunnelRoutes) {
      if (claim(seen, `tunnel:${route.hostname}`, route.source)) tunnelRoutes.push(route);
    }
  }
  for (const state of states) {
    for (const record of state.records) {
      if (seen.has(`tunnel:${record.hostname}`)) {
        console.warn(
          `[reconciler] duplicate hostname ${record.hostname}: already published via tunnel, ` +
            `skipping ${record.type} record from ${record.source.slice(0, 12)}`,
        );
        continue;
      }
      if (claim(seen, `${record.type}:${record.hostname}`, record.source)) records.push(record);
    }
  }
  return { records, tunnelRoutes };
}

function claim(seen: Set<string>, key: string, source: string): boolean {
  if (seen.has(key)) {
    console.warn(
      `[reconciler] duplicate desired entry ${key}: first container wins, ` +
        `skipping entry from ${source.slice(0, 12)}`,
    );
    return false;
  }
  seen.add(key);
  return true;
}
