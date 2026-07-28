import { describe, expect, test } from "bun:test";
import type { DockerClient } from "../docker/client";
import type { Provider } from "../providers/provider";
import { mergeDesired, Reconciler } from "./reconciler";
import type { ContainerInfo, DesiredState, DnsRecord, TunnelRoute } from "./types";

function container(id: string, labels: Record<string, string>): ContainerInfo {
  return { Id: id, Names: [`/${id}`], Labels: labels, State: "running" };
}

function record(hostname: string, over: Partial<DnsRecord> = {}): DnsRecord {
  return { hostname, type: "A", target: "10.0.0.1", ttl: 300, source: "c1", ...over };
}

function route(hostname: string, over: Partial<TunnelRoute> = {}): TunnelRoute {
  return { hostname, service: "http://app:80", source: "c1", ...over };
}

class FakeProvider implements Provider {
  readonly name = "fake";
  synced: DesiredState[] = [];
  failNext = false;

  async sync(desired: DesiredState): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("boom");
    }
    this.synced.push(desired);
  }
}

function fakeDocker(containers: ContainerInfo[]): DockerClient {
  return { listRunningContainers: async () => containers } as unknown as DockerClient;
}

describe("mergeDesired", () => {
  test("aggregates records and tunnel routes across containers", () => {
    const merged = mergeDesired([
      { records: [record("a.example.com")], tunnelRoutes: [] },
      { records: [], tunnelRoutes: [route("t.example.com")] },
    ]);
    expect(merged.records).toHaveLength(1);
    expect(merged.tunnelRoutes).toHaveLength(1);
  });

  test("dedupes duplicate hostname+type, first container wins", () => {
    const merged = mergeDesired([
      { records: [record("a.example.com", { target: "10.0.0.1" })], tunnelRoutes: [] },
      { records: [record("a.example.com", { target: "10.0.0.2", source: "c2" })], tunnelRoutes: [] },
    ]);
    expect(merged.records).toEqual([record("a.example.com", { target: "10.0.0.1" })]);
  });

  test("same hostname with different types is allowed", () => {
    const merged = mergeDesired([
      { records: [record("a.example.com"), record("a.example.com", { type: "AAAA", target: "::1" })], tunnelRoutes: [] },
    ]);
    expect(merged.records).toHaveLength(2);
  });

  test("tunnel route claims the hostname over any record", () => {
    const merged = mergeDesired([
      { records: [], tunnelRoutes: [route("a.example.com")] },
      { records: [record("a.example.com", { source: "c2" })], tunnelRoutes: [] },
    ]);
    expect(merged.records).toEqual([]);
    expect(merged.tunnelRoutes).toHaveLength(1);
  });

  test("dedupes duplicate tunnel routes, first wins", () => {
    const merged = mergeDesired([
      { records: [], tunnelRoutes: [route("a.example.com", { service: "http://one:80" })] },
      { records: [], tunnelRoutes: [route("a.example.com", { service: "http://two:80", source: "c2" })] },
    ]);
    expect(merged.tunnelRoutes).toEqual([route("a.example.com", { service: "http://one:80" })]);
  });
});

describe("Reconciler", () => {
  test("hands the provider the merged desired state from all containers", async () => {
    const provider = new FakeProvider();
    const reconciler = new Reconciler(
      fakeDocker([
        container("c1", { "dockroute.enabled": "true", "dockroute.hostname": "a.example.com" }),
        container("c2", {
          "dockroute.enabled": "true",
          "dockroute.hostname": "t.example.com",
          "dockroute.tunnel.service": "http://app:80",
        }),
      ]),
      provider,
      { defaultTarget: "10.0.0.1" },
    );

    await reconciler.reconcile();

    expect(provider.synced).toHaveLength(1);
    expect(provider.synced[0]?.records.map((r) => r.hostname)).toEqual(["a.example.com"]);
    expect(provider.synced[0]?.tunnelRoutes.map((t) => t.hostname)).toEqual(["t.example.com"]);
  });

  test("survives a provider error and keeps reconciling", async () => {
    const provider = new FakeProvider();
    provider.failNext = true;
    const reconciler = new Reconciler(fakeDocker([]), provider, {});

    await reconciler.reconcile();
    await reconciler.reconcile();

    expect(provider.synced).toHaveLength(1);
  });
});
