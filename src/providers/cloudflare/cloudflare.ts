import type { Config } from "../../config";
import type { DesiredState, DnsRecord, TunnelRoute } from "../../core/types";
import { type Provider, registerProvider } from "../provider";
import { DeleteGrace } from "../registry/grace";
import { parseOwnershipContent, parseTxtName } from "../registry/ownership";
import { type Plan, planChanges, type RegistryRecord } from "../registry/planner";
import {
  type CfDnsRecord,
  type CfDnsRecordInput,
  type CfZone,
  type CloudflareApi,
  CloudflareFetchApi,
} from "./api";
import { mergeIngress } from "./tunnel";

const PROXIED_HINT = "cloudflare.proxied";
/** Cloudflare forces TTL 1 ("auto") on proxied records; normalize both sides
 * before diffing or every reconcile issues a no-op update forever. */
const PROXIED_TTL = 1;

interface ActualEntry {
  registry: RegistryRecord;
  id: string;
}

export class CloudflareProvider implements Provider {
  readonly name = "cloudflare";

  constructor(
    private api: CloudflareApi,
    private config: Config,
    private grace: DeleteGrace = new DeleteGrace(config.deleteGraceSeconds),
  ) {}

  async sync(desired: DesiredState): Promise<void> {
    const tunnelDomain = this.tunnelDomain(desired.tunnelRoutes);
    const tunnelRoutes = tunnelDomain ? desired.tunnelRoutes : [];

    const desiredRegistry = [
      ...desired.records.map((r) => toRegistry(r)),
      ...tunnelRoutes.map((t) => tunnelCname(t, tunnelDomain!)),
    ];

    const zones = await this.matchingZones();
    const byZone = groupByZone(desiredRegistry, zones);
    for (const record of desiredRegistry) {
      if (!byZone.dropped.has(record.hostname)) continue;
      console.warn(`[cloudflare] ${record.hostname}: no matching zone, skipping`);
    }

    const managedTunnelHostnames = new Set<string>();
    const conflictedHostnames = new Set<string>();
    const deferredTunnelHostnames = new Set<string>();

    for (const zone of zones) {
      try {
        const actual = await this.fetchActual(zone.id);
        const desiredInZone = byZone.perZone.get(zone.id) ?? [];
        const { plan, deferred } = this.grace.apply(
          planChanges({
            desired: desiredInZone,
            actual: actual.map((e) => e.registry),
            ownerId: this.config.ownerId,
            txtPrefix: this.config.txtPrefix,
            policy: this.config.policy,
          }),
          zone.id,
          new Set(desiredInZone.map((r) => r.hostname)),
        );
        for (const c of plan.conflicts) {
          console.warn(`[cloudflare] conflict on ${c.type} ${c.hostname}: ${c.reason} — skipping`);
          conflictedHostnames.add(c.hostname);
        }
        await this.execute(zone, actual, plan);
        if (tunnelDomain) {
          for (const h of ownedTunnelHostnames(actual, tunnelDomain, this.config)) {
            managedTunnelHostnames.add(h);
          }
          for (const record of deferred) {
            if (record.type === "CNAME" && record.content === tunnelDomain) {
              deferredTunnelHostnames.add(record.hostname);
            }
          }
        }
      } catch (err) {
        console.error(`[cloudflare] zone ${zone.name}: sync failed:`, err);
      }
    }

    if (tunnelDomain) {
      const routes = tunnelRoutes.filter(
        (t) => !conflictedHostnames.has(t.hostname) && !byZone.dropped.has(t.hostname),
      );
      // managedTunnelHostnames holds only hostnames PROVEN ours via the TXT
      // registry before this run — a pre-existing ingress rule for a desired
      // hostname we do not own must surface as a conflict, never be replaced.
      await this.syncTunnelIngress(routes, managedTunnelHostnames, deferredTunnelHostnames);
    }
  }

  /** Resolves the tunnel CNAME target, or undefined when tunnel sync is unavailable. */
  private tunnelDomain(routes: TunnelRoute[]): string | undefined {
    if (routes.length === 0 && !this.config.cloudflare.tunnelId) return undefined;
    const { accountId, tunnelId } = this.config.cloudflare;
    if (!accountId || !tunnelId) {
      if (routes.length > 0) {
        console.warn(
          `[cloudflare] ${routes.length} tunnel route(s) requested but ` +
            `CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_TUNNEL_ID are not set — skipping tunnel sync`,
        );
      }
      return undefined;
    }
    return `${tunnelId}.cfargotunnel.com`;
  }

  private async matchingZones(): Promise<CfZone[]> {
    const zones = await this.api.listZones();
    const filter = this.config.domainFilter;
    if (filter.length === 0) return zones;
    return zones.filter((z) => filter.some((d) => z.name === d || z.name.endsWith(`.${d}`)));
  }

  private async fetchActual(zoneId: string): Promise<ActualEntry[]> {
    const wire = await this.api.listDnsRecords(zoneId);
    const entries: ActualEntry[] = [];
    for (const record of wire) {
      const registry = fromWire(record);
      if (registry) entries.push({ registry, id: record.id });
    }
    return entries;
  }

  private async execute(zone: CfZone, actual: ActualEntry[], plan: Plan): Promise<void> {
    const idFor = (record: RegistryRecord): string | undefined =>
      actual.find(
        (e) =>
          e.registry === record ||
          (e.registry.type === record.type && e.registry.hostname === record.hostname),
      )?.id;

    for (const record of plan.creates) {
      await this.apiCall(`create ${record.type} ${record.hostname}`, () =>
        this.api.createDnsRecord(zone.id, toWire(record)),
      );
    }
    for (const record of plan.updates) {
      const id = idFor(record);
      if (!id) continue;
      await this.apiCall(`update ${record.type} ${record.hostname}`, () =>
        this.api.updateDnsRecord(zone.id, id, toWire(record)),
      );
    }
    for (const record of plan.deletes) {
      const id = idFor(record);
      if (!id) continue;
      await this.apiCall(`delete ${record.type} ${record.hostname}`, () =>
        this.api.deleteDnsRecord(zone.id, id),
      );
    }
  }

  private async syncTunnelIngress(
    routes: TunnelRoute[],
    managedHostnames: Set<string>,
    retainHostnames: Set<string>,
  ): Promise<void> {
    const { accountId, tunnelId } = this.config.cloudflare;
    if (!accountId || !tunnelId) return;
    try {
      // Read immediately before writing to shrink the last-writer-wins window.
      const config = (await this.api.getTunnelConfig(accountId, tunnelId)) ?? {};
      const merged = mergeIngress({
        current: config.ingress ?? [],
        desired: routes.map((t) => ({ hostname: t.hostname, service: t.service })),
        managedHostnames,
        // A hostname whose CNAME deletion is still serving its grace window
        // keeps its ingress rule, so DNS and tunnel never disagree about it.
        retainHostnames,
        policy: this.config.policy,
      });
      for (const hostname of merged.conflicts) {
        console.warn(
          `[cloudflare] tunnel route ${hostname}: an unmanaged ingress rule claims this hostname — skipping`,
        );
      }
      if (merged.changed) {
        await this.api.putTunnelConfig(accountId, tunnelId, { ...config, ingress: merged.ingress });
        console.log(`[cloudflare] tunnel ingress updated (${merged.ingress.length} rule(s))`);
      }
    } catch (err) {
      console.error("[cloudflare] tunnel ingress sync failed:", err);
    }
  }

  private async apiCall(what: string, call: () => Promise<void>): Promise<void> {
    try {
      await call();
      console.log(`[cloudflare] ${what}`);
    } catch (err) {
      console.error(`[cloudflare] ${what} failed:`, err);
    }
  }
}

function toRegistry(record: DnsRecord): RegistryRecord {
  const proxied = record.providerSpecific?.[PROXIED_HINT] === "true";
  return {
    hostname: record.hostname,
    type: record.type,
    content: record.target,
    ttl: proxied ? PROXIED_TTL : record.ttl,
    providerSpecific: { [PROXIED_HINT]: String(proxied) },
    resource: `container/${record.source.slice(0, 12)}`,
  };
}

function tunnelCname(route: TunnelRoute, tunnelDomain: string): RegistryRecord {
  return {
    hostname: route.hostname,
    type: "CNAME",
    content: tunnelDomain,
    ttl: PROXIED_TTL,
    providerSpecific: { [PROXIED_HINT]: "true" },
    resource: `container/${route.source.slice(0, 12)}`,
  };
}

function fromWire(record: CfDnsRecord): RegistryRecord | undefined {
  if (record.type === "TXT") {
    return { hostname: record.name, type: "TXT", content: record.content, ttl: record.ttl };
  }
  if (record.type !== "A" && record.type !== "AAAA" && record.type !== "CNAME") return undefined;
  const proxied = record.proxied === true;
  return {
    hostname: record.name,
    type: record.type,
    content: record.content,
    ttl: proxied ? PROXIED_TTL : record.ttl,
    providerSpecific: { [PROXIED_HINT]: String(proxied) },
  };
}

function toWire(record: RegistryRecord): CfDnsRecordInput {
  return {
    type: record.type,
    name: record.hostname,
    content: record.content,
    ttl: record.ttl,
    ...(record.type !== "TXT"
      ? { proxied: record.providerSpecific?.[PROXIED_HINT] === "true" }
      : {}),
  };
}

/** Hostnames whose tunnel CNAME already exists AND carries our ownership TXT. */
function ownedTunnelHostnames(
  actual: ActualEntry[],
  tunnelDomain: string,
  config: Config,
): string[] {
  const ownedCnames = new Set<string>();
  for (const { registry } of actual) {
    if (registry.type !== "TXT") continue;
    const txtName = parseTxtName(registry.hostname, config.txtPrefix);
    if (txtName?.type !== "CNAME") continue;
    if (parseOwnershipContent(registry.content)?.owner === config.ownerId) {
      ownedCnames.add(txtName.hostname);
    }
  }
  return actual
    .filter(
      (e) =>
        e.registry.type === "CNAME" &&
        e.registry.content === tunnelDomain &&
        ownedCnames.has(e.registry.hostname),
    )
    .map((e) => e.registry.hostname);
}

function groupByZone(
  records: RegistryRecord[],
  zones: CfZone[],
): { perZone: Map<string, RegistryRecord[]>; dropped: Set<string> } {
  const perZone = new Map<string, RegistryRecord[]>();
  const dropped = new Set<string>();
  for (const record of records) {
    const zone = longestSuffixMatch(record.hostname, zones);
    if (!zone) {
      dropped.add(record.hostname);
      continue;
    }
    const list = perZone.get(zone.id) ?? [];
    list.push(record);
    perZone.set(zone.id, list);
  }
  return { perZone, dropped };
}

function longestSuffixMatch(hostname: string, zones: CfZone[]): CfZone | undefined {
  let best: CfZone | undefined;
  for (const zone of zones) {
    if (hostname !== zone.name && !hostname.endsWith(`.${zone.name}`)) continue;
    if (!best || zone.name.length > best.name.length) best = zone;
  }
  return best;
}

registerProvider("cloudflare", (config) => {
  const token = config.cloudflare.apiToken;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required for the cloudflare provider");
  return new CloudflareProvider(new CloudflareFetchApi(token), config);
});
