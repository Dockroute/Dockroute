import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("defaults to the local Docker socket", () => {
    expect(loadConfig({}).docker).toEqual({ kind: "unix", socketPath: "/var/run/docker.sock" });
  });

  test("connects to a socket proxy through DOCKER_HOST", () => {
    expect(loadConfig({ DOCKER_HOST: "tcp://socket-proxy:2375" }).docker).toEqual({
      kind: "tcp",
      baseUrl: "http://socket-proxy:2375",
    });
  });

  test("fails at startup on an unsupported DOCKER_HOST", () => {
    expect(() => loadConfig({ DOCKER_HOST: "ssh://user@host" })).toThrow(/Invalid DOCKER_HOST/);
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

  test("blank optional values fall back to their defaults", () => {
    for (const blank of ["", "   "]) {
      const config = loadConfig({
        DOCKROUTE_POLICY: blank,
        DOCKROUTE_PROVIDER: blank,
        DOCKROUTE_OWNER_ID: blank,
        DOCKROUTE_TXT_PREFIX: blank,
        DOCKROUTE_DEFAULT_TARGET: blank,
      });
      expect(config).toMatchObject({
        policy: "sync",
        provider: "log",
        ownerId: "default",
        txtPrefix: "_dockroute-",
      });
      expect(config.defaultTarget).toBeUndefined();
    }
  });

  test("keeps non-blank values exactly as given", () => {
    const config = loadConfig({ DOCKROUTE_OWNER_ID: "edge-1", DOCKROUTE_TXT_PREFIX: "_dr-" });
    expect(config.ownerId).toBe("edge-1");
    expect(config.txtPrefix).toBe("_dr-");
  });

  test("a blank API token does not satisfy the cloudflare provider", () => {
    for (const blank of ["", "   "]) {
      expect(() =>
        loadConfig({ DOCKROUTE_PROVIDER: "cloudflare", CLOUDFLARE_API_TOKEN: blank }),
      ).toThrow(/CLOUDFLARE_API_TOKEN/);
    }
  });

  test("blank Cloudflare account and tunnel ids mean unset", () => {
    const config = loadConfig({
      DOCKROUTE_PROVIDER: "cloudflare",
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "",
      CLOUDFLARE_TUNNEL_ID: "  ",
    });
    expect(config.cloudflare).toEqual({
      apiToken: "token",
      accountId: undefined,
      tunnelId: undefined,
    });
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

  describe("docker secrets", () => {
    const supportedEnvVariables = [
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_TUNNEL_ID",
    ];
    const secretsDir = mkdtempSync(join(tmpdir(), "dockroute-secrets-"));
    const createSecretFile = (filename: string, content: string): string => {
      const filePath = join(secretsDir, filename);

      writeFileSync(filePath, content);

      return filePath;
    };

    afterAll(() => {
      rmSync(secretsDir, { recursive: true });
    });

    test("reads API token from CLOUDFLARE_API_TOKEN_FILE without trailing newline", () => {
      const config = loadConfig({
        DOCKROUTE_PROVIDER: "cloudflare",
        CLOUDFLARE_API_TOKEN_FILE: createSecretFile("cf_token", "token-without-newline\n"),
      });

      expect(config.cloudflare.apiToken).toBe("token-without-newline");
    });

    test("reads supported _FILE variants", () => {
      const config = loadConfig({
        DOCKROUTE_PROVIDER: "cloudflare",
        CLOUDFLARE_API_TOKEN_FILE: createSecretFile("cf_token", "cloudflare-token\n"),
        CLOUDFLARE_ACCOUNT_ID_FILE: createSecretFile("cf_account", "cloudflare-account\n"),
        CLOUDFLARE_TUNNEL_ID_FILE: createSecretFile("cf_tunnel", "cloudlfare-tunnel"),
      });

      expect(config.cloudflare).toEqual({
        apiToken: "cloudflare-token",
        accountId: "cloudflare-account",
        tunnelId: "cloudlfare-tunnel",
      });
    });

    test.each(
      supportedEnvVariables.flatMap((envName) =>
        ["", " ", "\n"].map((emptyContent) => [envName, emptyContent]),
      ),
    )("throw an error when %s and %s_FILE are both set", (envName) => {
      expect(() =>
        loadConfig({
          DOCKROUTE_PROVIDER: "cloudflare",
          [envName]: "plain-value",
          [`${envName}_FILE`]: createSecretFile(envName, "secret-from-file"),
        }),
      ).toThrow();
    });

    test.each(supportedEnvVariables)("throw an error when %s_FILE is empty", (envName) => {
      ["", " ", "     ", "\n"].forEach((content) => {
        expect(() =>
          loadConfig({
            DOCKROUTE_PROVIDER: "cloudflare",
            [`${envName}_FILE`]: createSecretFile(envName, content),
          }),
        ).toThrow();
      });
    });
  });
});
