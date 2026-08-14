import { describe, expect, test } from "bun:test";
import { type Config, loadConfig } from "../../config";
import type { DesiredState, DnsRecord } from "../../core/types";
import type { PiholeApi } from "./api";
import { PiholeProvider } from "./pihole";

class FakePiholeApi implements PiholeApi {
  hosts: string[] = [];
  cnames: string[] = [];
  calls: string[] = [];

  async getHosts(): Promise<string[]> {
    return [...this.hosts];
  }

  async addHost(entry: string): Promise<void> {
    this.calls.push(`addHost:${entry}`);
    this.hosts.push(entry);
  }

  async deleteHost(entry: string): Promise<void> {
    this.calls.push(`deleteHost:${entry}`);
    this.hosts = this.hosts.filter((h) => h !== entry);
  }

  async getCnameRecords(): Promise<string[]> {
    return [...this.cnames];
  }

  async addCnameRecord(entry: string): Promise<void> {
    this.calls.push(`addCname:${entry}`);
    this.cnames.push(entry);
  }

  async deleteCnameRecord(entry: string): Promise<void> {
    this.calls.push(`deleteCname:${entry}`);
    this.cnames = this.cnames.filter((c) => c !== entry);
  }
}

function makeConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    DOCKROUTE_PROVIDER: "pihole",
    PIHOLE_URL: "http://pihole",
    PIHOLE_PASSWORD: "pw",
    DOCKROUTE_DOMAIN_FILTER: "home.lan",
    ...env,
  });
}

function record(hostname: string, over: Partial<DnsRecord> = {}): DnsRecord {
  return { hostname, type: "A", target: "10.0.0.1", ttl: 300, source: "c1", ...over };
}

function desired(records: DnsRecord[], over: Partial<DesiredState> = {}): DesiredState {
  return { records, tunnelRoutes: [], ...over };
}

describe("PiholeProvider — hosts (A/AAAA)", () => {
  test("creates a hosts entry for a desired A record", async () => {
    const api = new FakePiholeApi();
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(desired([record("app.home.lan")]));

    expect(api.hosts).toEqual(["10.0.0.1 app.home.lan"]);
  });

  test("leaves an up-to-date entry untouched", async () => {
    const api = new FakePiholeApi();
    api.hosts = ["10.0.0.1 app.home.lan"];
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(desired([record("app.home.lan")]));

    expect(api.calls).toEqual([]);
  });

  test("replaces the entry when the target IP changed", async () => {
    const api = new FakePiholeApi();
    api.hosts = ["10.0.0.9 app.home.lan"];
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(desired([record("app.home.lan", { target: "10.0.0.2" })]));

    expect(api.calls).toEqual([
      "deleteHost:10.0.0.9 app.home.lan",
      "addHost:10.0.0.2 app.home.lan",
    ]);
  });

  test("A and AAAA entries for the same hostname coexist", async () => {
    const api = new FakePiholeApi();
    api.hosts = ["fd00::1 app.home.lan"];
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(
      desired([
        record("app.home.lan"),
        record("app.home.lan", { type: "AAAA", target: "fd00::1" }),
      ]),
    );

    expect(api.hosts.sort()).toEqual(["10.0.0.1 app.home.lan", "fd00::1 app.home.lan"]);
    expect(api.calls).toEqual(["addHost:10.0.0.1 app.home.lan"]);
  });

  test("skips hostnames outside the domain filter", async () => {
    const api = new FakePiholeApi();
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(desired([record("app.example.com")]));

    expect(api.calls).toEqual([]);
  });

  test("deletes orphaned entries inside the filter under sync", async () => {
    const api = new FakePiholeApi();
    api.hosts = ["10.0.0.9 gone.home.lan"];
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(desired([]));

    expect(api.hosts).toEqual([]);
  });

  test("never deletes entries outside the filter", async () => {
    const api = new FakePiholeApi();
    api.hosts = ["192.168.1.1 router.example.com"];
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(desired([]));

    expect(api.hosts).toEqual(["192.168.1.1 router.example.com"]);
  });

  test("keeps orphans under upsert-only", async () => {
    const api = new FakePiholeApi();
    api.hosts = ["10.0.0.9 gone.home.lan"];
    const provider = new PiholeProvider(api, makeConfig({ DOCKROUTE_POLICY: "upsert-only" }));

    await provider.sync(desired([]));

    expect(api.hosts).toEqual(["10.0.0.9 gone.home.lan"]);
  });

  test("never updates under create-only", async () => {
    const api = new FakePiholeApi();
    api.hosts = ["10.0.0.9 app.home.lan"];
    const provider = new PiholeProvider(api, makeConfig({ DOCKROUTE_POLICY: "create-only" }));

    await provider.sync(desired([record("app.home.lan", { target: "10.0.0.2" })]));

    expect(api.hosts).toEqual(["10.0.0.9 app.home.lan"]);
  });

  test("leaves multi-hostname entries alone even inside the filter", async () => {
    const api = new FakePiholeApi();
    api.hosts = ["10.0.0.9 a.home.lan b.home.lan"];
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(desired([record("a.home.lan")]));

    // The multi-hostname entry is unmanaged: not updated, not deleted; the
    // desired record is created alongside it.
    expect(api.hosts).toEqual(["10.0.0.9 a.home.lan b.home.lan", "10.0.0.1 a.home.lan"]);
  });

  test("keeps syncing after an API failure on one entry", async () => {
    const api = new FakePiholeApi();
    api.addHost = async () => {
      throw new Error("boom");
    };
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(desired([record("a.home.lan")]));
    // No throw: the reconcile loop must stay alive.
  });
});

describe("PiholeProvider — CNAMEs", () => {
  test("creates a CNAME entry with TTL", async () => {
    const api = new FakePiholeApi();
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(
      desired([record("alias.home.lan", { type: "CNAME", target: "app.home.lan", ttl: 120 })]),
    );

    expect(api.cnames).toEqual(["alias.home.lan,app.home.lan,120"]);
  });

  test("leaves an up-to-date CNAME untouched", async () => {
    const api = new FakePiholeApi();
    api.cnames = ["alias.home.lan,app.home.lan,300"];
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(
      desired([record("alias.home.lan", { type: "CNAME", target: "app.home.lan" })]),
    );

    expect(api.calls).toEqual([]);
  });

  test("replaces a CNAME whose target changed", async () => {
    const api = new FakePiholeApi();
    api.cnames = ["alias.home.lan,old.home.lan,300"];
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(
      desired([record("alias.home.lan", { type: "CNAME", target: "new.home.lan" })]),
    );

    expect(api.calls).toEqual([
      "deleteCname:alias.home.lan,old.home.lan,300",
      "addCname:alias.home.lan,new.home.lan,300",
    ]);
  });

  test("deletes orphaned CNAMEs inside the filter under sync", async () => {
    const api = new FakePiholeApi();
    api.cnames = ["gone.home.lan,app.home.lan,300", "keep.example.com,x.example.com"];
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(desired([]));

    expect(api.cnames).toEqual(["keep.example.com,x.example.com"]);
  });
});

describe("PiholeProvider — tunnel routes", () => {
  test("warns and skips tunnel routes without throwing", async () => {
    const api = new FakePiholeApi();
    const provider = new PiholeProvider(api, makeConfig());

    await provider.sync(
      desired([], {
        tunnelRoutes: [{ hostname: "t.home.lan", service: "http://app:80", source: "c1" }],
      }),
    );

    expect(api.calls).toEqual([]);
  });
});
