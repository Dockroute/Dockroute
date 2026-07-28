import type { DesiredState } from "../core/types";
import { registerProvider, type Provider } from "./provider";

/** Dry-run provider: prints the desired state instead of writing DNS. */
class LogProvider implements Provider {
  readonly name = "log";

  async sync(desired: DesiredState): Promise<void> {
    const { records, tunnelRoutes } = desired;
    console.log(`[log] desired state: ${records.length} record(s), ${tunnelRoutes.length} tunnel route(s)`);
    for (const r of records) {
      console.log(`[log]   ${r.hostname} ${r.ttl} IN ${r.type} ${r.target} (from ${r.source.slice(0, 12)})`);
    }
    for (const t of tunnelRoutes) {
      console.log(`[log]   ${t.hostname} -> tunnel -> ${t.service} (from ${t.source.slice(0, 12)})`);
    }
  }
}

registerProvider("log", () => new LogProvider());
