import type { Config } from "../../config";
import type { DesiredState, DnsRecord } from "../../core/types";
import { type Provider, registerProvider } from "../provider";
import { type PiholeApi, PiholeFetchApi } from "./api";

/**
 * Pi-hole v6 local-DNS provider, for hostnames that must resolve only inside
 * the LAN (split-horizon: run a second DockRoute instance with a public
 * provider for everything else).
 *
 * Pi-hole cannot store TXT records, so the TXT ownership registry does not
 * apply. Instead — mirroring the Cloudflare Tunnel ingress model — DockRoute
 * assumes it is the ONLY writer for hostnames matching DOCKROUTE_DOMAIN_FILTER
 * (required for this provider) and never touches anything outside the filter.
 * Sync policies keep their usual semantics within that boundary.
 *
 * A/AAAA records ignore TTL (Pi-hole hosts entries have none); CNAMEs honor it.
 */

interface HostEntry {
  ip: string;
  hostname: string;
  raw: string;
}

interface CnameEntry {
  source: string;
  target: string;
  ttl?: string;
  raw: string;
}

export class PiholeProvider implements Provider {
  readonly name = "pihole";

  constructor(
    private api: PiholeApi,
    private config: Config,
  ) {}

  async sync(desired: DesiredState): Promise<void> {
    if (desired.tunnelRoutes.length > 0) {
      console.warn(
        `[pihole] ${desired.tunnelRoutes.length} tunnel route(s) requested but the pihole provider does not support tunnels — skipping`,
      );
    }

    const hostRecords: DnsRecord[] = [];
    const cnameRecords: DnsRecord[] = [];
    for (const record of desired.records) {
      if (!this.matchesFilter(record.hostname)) {
        console.warn(`[pihole] ${record.hostname}: outside DOCKROUTE_DOMAIN_FILTER, skipping`);
        continue;
      }
      if (record.type === "CNAME") cnameRecords.push(record);
      else hostRecords.push(record);
    }

    try {
      await this.syncHosts(hostRecords);
    } catch (err) {
      console.error("[pihole] hosts sync failed:", err);
    }
    try {
      await this.syncCnames(cnameRecords);
    } catch (err) {
      console.error("[pihole] CNAME sync failed:", err);
    }
  }

  private async syncHosts(records: DnsRecord[]): Promise<void> {
    const managed = new Map<string, HostEntry>();
    for (const raw of await this.api.getHosts()) {
      const tokens = raw.trim().split(/\s+/);
      if (tokens.length < 2) continue;
      const [ip, ...hostnames] = tokens as [string, ...string[]];
      if (!hostnames.some((h) => this.matchesFilter(h))) continue;
      if (hostnames.length > 1) {
        console.warn(`[pihole] "${raw}": multi-hostname entries are not managed — skipping`);
        continue;
      }
      const hostname = hostnames[0] as string;
      const key = hostKey(ip, hostname);
      if (!managed.has(key)) managed.set(key, { ip, hostname, raw });
    }

    const desiredKeys = new Set<string>();
    for (const want of records) {
      const key = `${want.type}:${want.hostname}`;
      desiredKeys.add(key);
      const entry = `${want.target} ${want.hostname}`;
      const existing = managed.get(key);
      if (existing) {
        if (existing.ip === want.target || this.config.policy === "create-only") continue;
        await this.apiCall(`update ${want.type} ${want.hostname} -> ${want.target}`, async () => {
          await this.api.deleteHost(existing.raw);
          await this.api.addHost(entry);
        });
      } else {
        await this.apiCall(`create ${want.type} ${want.hostname} -> ${want.target}`, () =>
          this.api.addHost(entry),
        );
      }
    }

    if (this.config.policy !== "sync") return;
    for (const [key, entry] of managed) {
      if (desiredKeys.has(key)) continue;
      await this.apiCall(`delete orphan "${entry.raw}"`, () => this.api.deleteHost(entry.raw));
    }
  }

  private async syncCnames(records: DnsRecord[]): Promise<void> {
    const managed = new Map<string, CnameEntry>();
    for (const raw of await this.api.getCnameRecords()) {
      const parts = raw.split(",").map((p) => p.trim());
      const [source, target, ttl] = parts;
      if (parts.length < 2 || parts.length > 3 || !source || !target) continue;
      if (!this.matchesFilter(source)) continue;
      if (!managed.has(source)) managed.set(source, { source, target, ttl, raw });
    }

    const desiredSources = new Set<string>();
    for (const want of records) {
      desiredSources.add(want.hostname);
      const entry = `${want.hostname},${want.target},${want.ttl}`;
      const existing = managed.get(want.hostname);
      if (existing) {
        const unchanged = existing.target === want.target && existing.ttl === String(want.ttl);
        if (unchanged || this.config.policy === "create-only") continue;
        await this.apiCall(`update CNAME ${want.hostname} -> ${want.target}`, async () => {
          await this.api.deleteCnameRecord(existing.raw);
          await this.api.addCnameRecord(entry);
        });
      } else {
        await this.apiCall(`create CNAME ${want.hostname} -> ${want.target}`, () =>
          this.api.addCnameRecord(entry),
        );
      }
    }

    if (this.config.policy !== "sync") return;
    for (const [source, entry] of managed) {
      if (desiredSources.has(source)) continue;
      await this.apiCall(`delete orphan CNAME "${entry.raw}"`, () =>
        this.api.deleteCnameRecord(entry.raw),
      );
    }
  }

  private matchesFilter(hostname: string): boolean {
    return this.config.domainFilter.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  }

  private async apiCall(what: string, call: () => Promise<void>): Promise<void> {
    try {
      await call();
      console.log(`[pihole] ${what}`);
    } catch (err) {
      console.error(`[pihole] ${what} failed:`, err);
    }
  }
}

/** A/AAAA live in the same hosts list; the address family disambiguates. */
function hostKey(ip: string, hostname: string): string {
  return `${ip.includes(":") ? "AAAA" : "A"}:${hostname}`;
}

registerProvider("pihole", (config) => {
  const { url, password } = config.pihole;
  if (!url || !password) {
    throw new Error("PIHOLE_URL and PIHOLE_PASSWORD are required for the pihole provider");
  }
  return new PiholeProvider(new PiholeFetchApi(url, password), config);
});
