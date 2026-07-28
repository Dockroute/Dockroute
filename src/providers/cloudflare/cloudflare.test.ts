import { describe, expect, test } from "bun:test";
import { loadConfig, type Config } from "../../config";
import type { DesiredState, DnsRecord, TunnelRoute } from "../../core/types";
import { formatOwnershipContent } from "../registry/ownership";
import type {
  CfDnsRecord,
  CfDnsRecordInput,
  CfIngressRule,
  CfTunnelConfig,
  CfZone,
  CloudflareApi,
} from "./api";
import { CloudflareProvider } from "./cloudflare";

const TUNNEL_ID = "tun-1";
const TUNNEL_DOMAIN = `${TUNNEL_ID}.cfargotunnel.com`;
const CATCH_ALL: CfIngressRule = { service: "http_status:404" };

class FakeCloudflareApi implements CloudflareApi {
  zones: CfZone[] = [{ id: "z1", name: "example.com" }];
  records = new Map<string, CfDnsRecord[]>([["z1", []]]);
  tunnelConfig: CfTunnelConfig | null = null;
  tunnelPuts: CfTunnelConfig[] = [];
  private nextId = 1;

  seed(zoneId: string, record: Omit<CfDnsRecord, "id">): CfDnsRecord {
    const stored = { ...record, id: `r${this.nextId++}` };
    this.records.get(zoneId)!.push(stored);
    return stored;
  }

  async listZones(): Promise<CfZone[]> {
    return this.zones;
  }

  async listDnsRecords(zoneId: string): Promise<CfDnsRecord[]> {
    return [...(this.records.get(zoneId) ?? [])];
  }

  async createDnsRecord(zoneId: string, record: CfDnsRecordInput): Promise<void> {
    this.seed(zoneId, record);
  }

  async updateDnsRecord(zoneId: string, recordId: string, record: CfDnsRecordInput): Promise<void> {
    const list = this.records.get(zoneId) ?? [];
    const index = list.findIndex((r) => r.id === recordId);
    if (index === -1) throw new Error(`no such record ${recordId}`);
    list[index] = { ...record, id: recordId };
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    const list = this.records.get(zoneId) ?? [];
    this.records.set(zoneId, list.filter((r) => r.id !== recordId));
  }

  async getTunnelConfig(): Promise<CfTunnelConfig | null> {
    return this.tunnelConfig;
  }

  async putTunnelConfig(_a: string, _t: string, config: CfTunnelConfig): Promise<void> {
    this.tunnelConfig = config;
    this.tunnelPuts.push(config);
  }

  find(zoneId: string, type: string, name: string): CfDnsRecord | undefined {
    return (this.records.get(zoneId) ?? []).find((r) => r.type === type && r.name === name);
  }
}

function makeConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    DOCKROUTE_PROVIDER: "cloudflare",
    CLOUDFLARE_API_TOKEN: "token",
    DOCKROUTE_OWNER_ID: "home-lab",
    ...env,
  });
}

const tunnelEnv = { CLOUDFLARE_ACCOUNT_ID: "acc-1", CLOUDFLARE_TUNNEL_ID: TUNNEL_ID };

function record(hostname: string, over: Partial<DnsRecord> = {}): DnsRecord {
  return { hostname, type: "A", target: "10.0.0.1", ttl: 300, source: "c1", ...over };
}

function route(hostname: string, over: Partial<TunnelRoute> = {}): TunnelRoute {
  return { hostname, service: "http://app:80", source: "c1", ...over };
}

function desired(over: Partial<DesiredState> = {}): DesiredState {
  return { records: [], tunnelRoutes: [], ...over };
}

const OWNED_TXT = formatOwnershipContent({ owner: "home-lab" });

function seedOwned(api: FakeCloudflareApi, hostname: string, over: Partial<CfDnsRecord> = {}) {
  const type = over.type ?? "A";
  api.seed("z1", { type, name: hostname, content: over.content ?? "10.0.0.1", ttl: over.ttl ?? 300, ...over });
  api.seed("z1", {
    type: "TXT",
    name: `_dockroute-${type.toLowerCase()}.${hostname}`,
    content: OWNED_TXT,
    ttl: 300,
  });
}

describe("CloudflareProvider — DNS", () => {
  test("creates the record and its ownership TXT", async () => {
    const api = new FakeCloudflareApi();
    const provider = new CloudflareProvider(api, makeConfig());

    await provider.sync(desired({ records: [record("a.example.com")] }));

    expect(api.find("z1", "A", "a.example.com")).toMatchObject({
      content: "10.0.0.1",
      ttl: 300,
      proxied: false,
    });
    expect(api.find("z1", "TXT", "_dockroute-a.a.example.com")?.content).toBe(
      formatOwnershipContent({ owner: "home-lab", resource: "container/c1" }),
    );
  });

  test("routes each hostname to the longest matching zone", async () => {
    const api = new FakeCloudflareApi();
    api.zones = [
      { id: "z1", name: "example.com" },
      { id: "z2", name: "sub.example.com" },
    ];
    api.records.set("z2", []);
    const provider = new CloudflareProvider(api, makeConfig());

    await provider.sync(desired({ records: [record("a.sub.example.com"), record("b.example.com")] }));

    expect(api.find("z2", "A", "a.sub.example.com")).toBeDefined();
    expect(api.find("z1", "A", "a.sub.example.com")).toBeUndefined();
    expect(api.find("z1", "A", "b.example.com")).toBeDefined();
  });

  test("skips hostnames without a matching zone", async () => {
    const api = new FakeCloudflareApi();
    const provider = new CloudflareProvider(api, makeConfig());

    await provider.sync(desired({ records: [record("a.other.org")] }));

    expect(api.records.get("z1")).toEqual([]);
  });

  test("respects the domain filter", async () => {
    const api = new FakeCloudflareApi();
    const provider = new CloudflareProvider(api, makeConfig({ DOCKROUTE_DOMAIN_FILTER: "other.org" }));

    await provider.sync(desired({ records: [record("a.example.com")] }));

    expect(api.records.get("z1")).toEqual([]);
  });

  test("never touches an existing record without our ownership TXT", async () => {
    const api = new FakeCloudflareApi();
    const manual = api.seed("z1", { type: "A", name: "a.example.com", content: "1.2.3.4", ttl: 60 });
    const provider = new CloudflareProvider(api, makeConfig());

    await provider.sync(desired({ records: [record("a.example.com")] }));

    expect(api.find("z1", "A", "a.example.com")).toEqual(manual);
    expect(api.find("z1", "TXT", "_dockroute-a.a.example.com")).toBeUndefined();
  });

  test("updates an owned record whose target changed", async () => {
    const api = new FakeCloudflareApi();
    seedOwned(api, "a.example.com", { content: "10.0.0.9" });
    const provider = new CloudflareProvider(api, makeConfig());

    await provider.sync(desired({ records: [record("a.example.com")] }));

    expect(api.find("z1", "A", "a.example.com")?.content).toBe("10.0.0.1");
  });

  test("sync deletes owned orphans together with their TXT", async () => {
    const api = new FakeCloudflareApi();
    seedOwned(api, "gone.example.com");
    const provider = new CloudflareProvider(api, makeConfig());

    await provider.sync(desired());

    expect(api.records.get("z1")).toEqual([]);
  });

  test("upsert-only keeps owned orphans", async () => {
    const api = new FakeCloudflareApi();
    seedOwned(api, "gone.example.com");
    const provider = new CloudflareProvider(api, makeConfig({ DOCKROUTE_POLICY: "upsert-only" }));

    await provider.sync(desired());

    expect(api.records.get("z1")).toHaveLength(2);
  });

  test("proxied records do not cause perpetual TTL updates", async () => {
    const api = new FakeCloudflareApi();
    // Cloudflare stores proxied records with ttl=1 regardless of the label.
    seedOwned(api, "a.example.com", { proxied: true, ttl: 1 });
    let updates = 0;
    const originalUpdate = api.updateDnsRecord.bind(api);
    api.updateDnsRecord = async (...args) => {
      updates++;
      return originalUpdate(...args);
    };
    const provider = new CloudflareProvider(api, makeConfig());

    await provider.sync(
      desired({
        records: [record("a.example.com", { providerSpecific: { "cloudflare.proxied": "true" } })],
      }),
    );

    expect(updates).toBe(0);
  });
});

describe("CloudflareProvider — tunnel", () => {
  test("creates a proxied CNAME to the tunnel domain and adds the ingress route", async () => {
    const api = new FakeCloudflareApi();
    const provider = new CloudflareProvider(api, makeConfig(tunnelEnv));

    await provider.sync(desired({ tunnelRoutes: [route("t.example.com")] }));

    expect(api.find("z1", "CNAME", "t.example.com")).toMatchObject({
      content: TUNNEL_DOMAIN,
      proxied: true,
    });
    expect(api.find("z1", "TXT", "_dockroute-cname.t.example.com")).toBeDefined();
    expect(api.tunnelConfig?.ingress).toEqual([
      { hostname: "t.example.com", service: "http://app:80" },
      CATCH_ALL,
    ]);
  });

  test("warns and skips tunnel routes when tunnel config is missing", async () => {
    const api = new FakeCloudflareApi();
    const provider = new CloudflareProvider(api, makeConfig());

    await provider.sync(desired({ tunnelRoutes: [route("t.example.com")] }));

    expect(api.find("z1", "CNAME", "t.example.com")).toBeUndefined();
    expect(api.tunnelPuts).toEqual([]);
  });

  test("preserves unmanaged ingress rules and other config fields", async () => {
    const api = new FakeCloudflareApi();
    api.tunnelConfig = {
      ingress: [{ hostname: "keep.example.com", service: "http://keep:80" }, CATCH_ALL],
      "warp-routing": { enabled: true },
    };
    const provider = new CloudflareProvider(api, makeConfig(tunnelEnv));

    await provider.sync(desired({ tunnelRoutes: [route("t.example.com")] }));

    expect(api.tunnelConfig.ingress).toEqual([
      { hostname: "keep.example.com", service: "http://keep:80" },
      { hostname: "t.example.com", service: "http://app:80" },
      CATCH_ALL,
    ]);
    expect(api.tunnelConfig["warp-routing"]).toEqual({ enabled: true });
  });

  test("does not PUT when the ingress is already correct", async () => {
    const api = new FakeCloudflareApi();
    seedOwned(api, "t.example.com", { type: "CNAME", content: TUNNEL_DOMAIN, proxied: true, ttl: 1 });
    api.tunnelConfig = {
      ingress: [{ hostname: "t.example.com", service: "http://app:80" }, CATCH_ALL],
    };
    const provider = new CloudflareProvider(api, makeConfig(tunnelEnv));

    await provider.sync(desired({ tunnelRoutes: [route("t.example.com")] }));

    expect(api.tunnelPuts).toEqual([]);
  });

  test("sync removes an orphaned managed route and its CNAME", async () => {
    const api = new FakeCloudflareApi();
    seedOwned(api, "gone.example.com", { type: "CNAME", content: TUNNEL_DOMAIN, proxied: true, ttl: 1 });
    api.tunnelConfig = {
      ingress: [{ hostname: "gone.example.com", service: "http://gone:80" }, CATCH_ALL],
    };
    const provider = new CloudflareProvider(api, makeConfig(tunnelEnv));

    await provider.sync(desired());

    expect(api.records.get("z1")).toEqual([]);
    expect(api.tunnelConfig?.ingress).toEqual([CATCH_ALL]);
  });

  test("an ingress rule owned by nobody blocks our route (conflict)", async () => {
    const api = new FakeCloudflareApi();
    api.tunnelConfig = {
      ingress: [{ hostname: "t.example.com", service: "http://theirs:80" }, CATCH_ALL],
    };
    const provider = new CloudflareProvider(api, makeConfig(tunnelEnv));

    await provider.sync(desired({ tunnelRoutes: [route("t.example.com")] }));

    expect(api.tunnelConfig.ingress?.[0]?.service).toBe("http://theirs:80");
    expect(api.tunnelPuts).toEqual([]);
  });
});
