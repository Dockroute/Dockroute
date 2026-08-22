import type { Plan, RegistryRecord } from "./planner";

/**
 * Deletion hysteresis, provider-agnostic.
 *
 * A container that restarts leaves the desired state for a few seconds, and
 * deleting its record in that window costs far more than the outage itself:
 * the resulting failure is cached at the DNS edge and by resolvers long after
 * the container is back. Creates and updates are cheap and self-correcting,
 * deletes are not, so only deletes wait: a record must be absent from the
 * desired state for the whole grace window before it is really removed, and
 * a record that reappears in the meantime is never deleted at all.
 *
 * The state is per-process and in-memory. Losing it on a DockRoute restart
 * only reopens the window, which is the safe direction.
 */
export class DeleteGrace {
  private missingSince = new Map<string, number>();

  constructor(
    private graceSeconds: number,
    private now: () => number = Date.now,
  ) {}

  /**
   * Splits a plan's deletes into those that have waited out the grace window
   * and those still serving it. `scope` namespaces the tracked keys (the zone
   * id for Cloudflare); every key in that scope missing from this plan is
   * pruned, so a record that came back forgets its timer.
   */
  apply(
    plan: Plan,
    scope: string,
    desiredHostnames: Set<string> = new Set(),
  ): { plan: Plan; deferred: RegistryRecord[] } {
    if (this.graceSeconds <= 0) return { plan, deferred: [] };

    const now = this.now();
    const due: RegistryRecord[] = [];
    const deferred: RegistryRecord[] = [];
    const planned = new Set<string>();

    for (const record of plan.deletes) {
      // The window exists to keep a hostname resolving. One that is still
      // desired is being replaced, not removed (a plain A record becoming a
      // tunnel CNAME, say), and holding its stale record back would only
      // block the replacement.
      if (desiredHostnames.has(record.hostname)) {
        due.push(record);
        continue;
      }

      const key = keyFor(scope, record);
      planned.add(key);
      // A key kept after expiry lets a delete that failed at the provider be
      // retried on the next reconcile instead of serving a fresh window.
      const since = this.missingSince.get(key) ?? now;
      this.missingSince.set(key, since);

      const remaining = this.graceSeconds - (now - since) / 1000;
      if (remaining <= 0) {
        due.push(record);
        continue;
      }
      deferred.push(record);
      // The companion TXT rides the same window; logging it too is noise.
      if (record.type !== "TXT") {
        console.log(
          `[grace] ${record.type} ${record.hostname}: pending deletion, ` +
            `${Math.ceil(remaining)}s remaining`,
        );
      }
    }

    this.prune(scope, planned);
    return { plan: { ...plan, deletes: due }, deferred };
  }

  private prune(scope: string, planned: Set<string>): void {
    const prefix = `${scope}|`;
    for (const key of this.missingSince.keys()) {
      if (key.startsWith(prefix) && !planned.has(key)) this.missingSince.delete(key);
    }
  }
}

function keyFor(scope: string, record: RegistryRecord): string {
  return `${scope}|${record.type}:${record.hostname}`;
}
