import { describe, expect, test } from "bun:test";
import type { Config } from "../config";
import type { Provider } from "../core/ports";
import { createProvider, registerProvider } from "./provider";

function fakeConfig(overrides: Partial<Config> = {}): Config {
  return {
    docker: { kind: "unix", socketPath: "/var/run/docker.sock" },
    provider: "log",
    resyncSeconds: 60,
    ownerId: "default",
    policy: "sync",
    deleteGraceSeconds: 60,
    txtPrefix: "_dockroute-",
    domainFilter: [],
    cloudflare: {},
    ...overrides,
  };
}

describe("createProvider", () => {
  test("returns the registered factory's provider and passes the config through", () => {
    const name = `fake-${crypto.randomUUID()}`;
    let seen: Config | undefined;
    const provider: Provider = { name, sync: async () => {} };

    registerProvider(name, (config) => {
      seen = config;
      return provider;
    });

    const config = fakeConfig({ ownerId: "test-owner" });
    expect(createProvider(name, config)).toBe(provider);
    expect(seen).toBe(config);
  });

  test("throws for an unknown name and lists the available providers", () => {
    const known = `known-${crypto.randomUUID()}`;
    registerProvider(known, () => ({ name: known, sync: async () => {} }));

    expect(() => createProvider("definitely-not-registered", fakeConfig())).toThrow(
      /Unknown provider "definitely-not-registered".*Available:.*\bknown-/,
    );
  });
});
