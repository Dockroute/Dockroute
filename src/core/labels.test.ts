import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { desiredFromContainer } from "./labels";
import type { ContainerInfo } from "./types";

function container(labels: Record<string, string>): ContainerInfo {
  return { Id: "abc123def4567890", Names: ["/whoami"], Labels: labels, State: "running" };
}

const empty = { records: [], tunnelRoutes: [] };

describe("desiredFromContainer", () => {
  let warnSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = undefined;
  });

  test("ignores containers without dockroute.enabled", () => {
    expect(desiredFromContainer(container({}))).toEqual(empty);
    expect(desiredFromContainer(container({ "dockroute.hostname": "a.example.com" }))).toEqual(
      empty,
    );
  });

  test("builds an A record with defaults", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
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
    expect(warnSpy).not.toHaveBeenCalled();
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

  test("validates targets against their record type", () => {
    for (const [type, target] of [
      ["A", "192.0.2.1"],
      ["AAAA", "2001:db8::1"],
      ["CNAME", "origin.example.com"],
    ] as const) {
      const { records } = desiredFromContainer(
        container({
          "dockroute.enabled": "true",
          "dockroute.hostname": "app.example.com",
          "dockroute.type": type,
          "dockroute.target": target,
        }),
      );
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ type, target });
    }
  });

  test("skips targets that do not match their record type", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    for (const [type, target, expected] of [
      ["A", "2001:db8::1", "IPv4 address for an A record"],
      ["AAAA", "192.0.2.1", "IPv6 address for an AAAA record"],
      ["CNAME", "192.0.2.1", "hostname for a CNAME record"],
      ["CNAME", "2001:db8::1", "hostname for a CNAME record"],
      ["CNAME", "   ", "hostname for a CNAME record"],
    ] as const) {
      expect(
        desiredFromContainer(
          container({
            "dockroute.enabled": "true",
            "dockroute.hostname": "app.example.com",
            "dockroute.type": type,
            "dockroute.target": target,
          }),
        ),
      ).toEqual(empty);
      expect(warnSpy).toHaveBeenLastCalledWith(
        `[labels] /whoami: dockroute.target "${target}" is not a valid ${expected}, skipping`,
      );
    }
  });

  test("validates an inherited default target", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    expect(
      desiredFromContainer(
        container({
          "dockroute.enabled": "true",
          "dockroute.hostname": "app.example.com",
          "dockroute.type": "AAAA",
        }),
        { defaultTarget: "192.0.2.1" },
      ),
    ).toEqual(empty);
    expect(warnSpy).toHaveBeenCalledWith(
      '[labels] /whoami: dockroute.target "192.0.2.1" is not a valid IPv6 address for an AAAA record, skipping',
    );
  });

  test("warns and uses the default when an explicit ttl is invalid", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const [record] = desiredFromContainer(
      container({
        "dockroute.enabled": "true",
        "dockroute.hostname": "a.example.com",
        "dockroute.target": "10.0.0.1",
        "dockroute.ttl": "5m",
      }),
    ).records;

    expect(record?.ttl).toBe(300);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[labels] /whoami: invalid dockroute.ttl "5m", using 300');
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
        "dockroute.type": "AAAA",
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
