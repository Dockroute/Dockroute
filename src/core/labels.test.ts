import { describe, expect, test } from "bun:test";
import { desiredFromContainer } from "./labels";
import type { ContainerInfo } from "./types";

function container(labels: Record<string, string>): ContainerInfo {
  return { Id: "abc123def4567890", Names: ["/whoami"], Labels: labels, State: "running" };
}

const empty = { records: [], tunnelRoutes: [] };

describe("desiredFromContainer", () => {
  test("ignores containers without dockroute.enabled", () => {
    expect(desiredFromContainer(container({}))).toEqual(empty);
    expect(desiredFromContainer(container({ "dockroute.hostname": "a.example.com" }))).toEqual(
      empty,
    );
  });

  test("builds an A record with defaults", () => {
    const { records } = desiredFromContainer(
      container({ "dockroute.enabled": "true", "dockroute.hostname": "a.example.com" }),
      { defaultTarget: "192.168.1.10" },
    );
    expect(records).toEqual([
      {
        hostname: "a.example.com",
        type: "A",
        target: "192.168.1.10",
        ttl: 300,
        source: "abc123def4567890",
      },
    ]);
  });

  test("supports multiple comma-separated hostnames", () => {
    const { records } = desiredFromContainer(
      container({
        "dockroute.enabled": "true",
        "dockroute.hostname": "a.example.com, b.example.com",
        "dockroute.target": "10.0.0.1",
      }),
    );
    expect(records.map((r) => r.hostname)).toEqual(["a.example.com", "b.example.com"]);
  });

  test("honours explicit type, target and ttl", () => {
    const [record] = desiredFromContainer(
      container({
        "dockroute.enabled": "true",
        "dockroute.hostname": "cname.example.com",
        "dockroute.type": "cname",
        "dockroute.target": "origin.example.com",
        "dockroute.ttl": "60",
      }),
    ).records;
    expect(record).toMatchObject({ type: "CNAME", target: "origin.example.com", ttl: 60 });
  });

  test("skips when no target is resolvable or type is unsupported", () => {
    expect(
      desiredFromContainer(
        container({ "dockroute.enabled": "true", "dockroute.hostname": "a.example.com" }),
      ),
    ).toEqual(empty);
    expect(
      desiredFromContainer(
        container({
          "dockroute.enabled": "true",
          "dockroute.hostname": "a.example.com",
          "dockroute.type": "MX",
          "dockroute.target": "10.0.0.1",
        }),
      ),
    ).toEqual(empty);
  });

  test("passes provider-specific labels through", () => {
    const [record] = desiredFromContainer(
      container({
        "dockroute.enabled": "true",
        "dockroute.hostname": "a.example.com",
        "dockroute.target": "10.0.0.1",
        "dockroute.cloudflare.proxied": "true",
      }),
    ).records;
    expect(record?.providerSpecific).toEqual({ "cloudflare.proxied": "true" });
  });

  test("builds tunnel routes for every hostname when tunnel.service is set", () => {
    const state = desiredFromContainer(
      container({
        "dockroute.enabled": "true",
        "dockroute.hostname": "a.example.com, b.example.com",
        "dockroute.tunnel.service": "http://whoami:8080",
      }),
    );
    expect(state.records).toEqual([]);
    expect(state.tunnelRoutes).toEqual([
      { hostname: "a.example.com", service: "http://whoami:8080", source: "abc123def4567890" },
      { hostname: "b.example.com", service: "http://whoami:8080", source: "abc123def4567890" },
    ]);
  });

  test("tunnel mode wins over dockroute.type/target", () => {
    const state = desiredFromContainer(
      container({
        "dockroute.enabled": "true",
        "dockroute.hostname": "a.example.com",
        "dockroute.tunnel.service": "https://whoami:443",
        "dockroute.type": "A",
        "dockroute.target": "10.0.0.1",
      }),
    );
    expect(state.records).toEqual([]);
    expect(state.tunnelRoutes).toHaveLength(1);
  });

  test("skips invalid tunnel service URLs", () => {
    for (const service of ["whoami:8080", "ftp://whoami:21", "not a url"]) {
      expect(
        desiredFromContainer(
          container({
            "dockroute.enabled": "true",
            "dockroute.hostname": "a.example.com",
            "dockroute.tunnel.service": service,
          }),
        ),
      ).toEqual(empty);
    }
  });
});
