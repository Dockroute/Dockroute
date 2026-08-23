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
      deleteGraceSeconds: 60,
    });
  });

  test("parses the delete grace, zero included", () => {
    expect(loadConfig({ DOCKROUTE_DELETE_GRACE_SECONDS: "180" }).deleteGraceSeconds).toBe(180);
    expect(loadConfig({ DOCKROUTE_DELETE_GRACE_SECONDS: "0" }).deleteGraceSeconds).toBe(0);
  });

  test("a blank delete grace means unset, not zero", () => {
    for (const value of ["", "   "]) {
      expect(loadConfig({ DOCKROUTE_DELETE_GRACE_SECONDS: value }).deleteGraceSeconds).toBe(60);
    }
  });

  test("rejects a negative or non-numeric delete grace", () => {
    for (const value of ["-1", "soon"]) {
      expect(() => loadConfig({ DOCKROUTE_DELETE_GRACE_SECONDS: value })).toThrow(
        /Invalid DOCKROUTE_DELETE_GRACE_SECONDS/,
      );
    }
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

  test("parses a valid resync interval", () => {
    expect(loadConfig({ DOCKROUTE_RESYNC_SECONDS: "30" }).resyncSeconds).toBe(30);
  });

  test("a blank resync interval means unset", () => {
    for (const value of ["", "   "]) {
      expect(loadConfig({ DOCKROUTE_RESYNC_SECONDS: value }).resyncSeconds).toBe(60);
    }
  });

  test("rejects invalid resync intervals", () => {
    for (const value of ["60s", "0", "-1", "0.5"]) {
      expect(() => loadConfig({ DOCKROUTE_RESYNC_SECONDS: value })).toThrow(
        /Invalid DOCKROUTE_RESYNC_SECONDS/,
      );
    }
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
});
