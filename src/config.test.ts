import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  test("applies defaults", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      provider: "log",
      policy: "sync",
      ownerId: "default",
      txtPrefix: "_dockroute-",
      domainFilter: [],
      resyncSeconds: 60,
    });
  });

  test("accepts every valid policy", () => {
    for (const policy of ["sync", "upsert-only", "create-only"]) {
      expect(loadConfig({ DOCKROUTE_POLICY: policy }).policy).toBe(policy as never);
    }
  });

  test("rejects an invalid policy", () => {
    expect(() => loadConfig({ DOCKROUTE_POLICY: "delete-everything" })).toThrow(
      /Invalid DOCKROUTE_POLICY/,
    );
  });

  test("parses the domain filter as a trimmed list", () => {
    const config = loadConfig({ DOCKROUTE_DOMAIN_FILTER: "example.com, example.org ," });
    expect(config.domainFilter).toEqual(["example.com", "example.org"]);
  });

  test("requires an API token for the cloudflare provider", () => {
    expect(() => loadConfig({ DOCKROUTE_PROVIDER: "cloudflare" })).toThrow(/CLOUDFLARE_API_TOKEN/);
    const config = loadConfig({
      DOCKROUTE_PROVIDER: "cloudflare",
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_TUNNEL_ID: "tun",
    });
    expect(config.cloudflare).toEqual({ apiToken: "token", accountId: "acc", tunnelId: "tun" });
  });

  test("requires url and password for the pihole provider", () => {
    expect(() => loadConfig({ DOCKROUTE_PROVIDER: "pihole" })).toThrow(
      /PIHOLE_URL and PIHOLE_PASSWORD/,
    );
  });

  test("requires a domain filter for the pihole provider", () => {
    expect(() =>
      loadConfig({
        DOCKROUTE_PROVIDER: "pihole",
        PIHOLE_URL: "http://pihole",
        PIHOLE_PASSWORD: "pw",
      }),
    ).toThrow(/DOCKROUTE_DOMAIN_FILTER is required/);
    const config = loadConfig({
      DOCKROUTE_PROVIDER: "pihole",
      PIHOLE_URL: "http://pihole",
      PIHOLE_PASSWORD: "pw",
      DOCKROUTE_DOMAIN_FILTER: "home.lan",
    });
    expect(config.pihole).toEqual({ url: "http://pihole", password: "pw" });
  });
});
