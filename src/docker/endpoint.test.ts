import { describe, expect, test } from "bun:test";
import { describeDockerEndpoint, resolveDockerEndpoint } from "./endpoint";

describe("resolveDockerEndpoint", () => {
  test("defaults to the standard unix socket", () => {
    expect(resolveDockerEndpoint({})).toEqual({
      kind: "unix",
      socketPath: "/var/run/docker.sock",
    });
  });

  test("keeps honoring DOCKER_SOCK", () => {
    expect(resolveDockerEndpoint({ DOCKER_SOCK: "/run/user/1000/docker.sock" })).toEqual({
      kind: "unix",
      socketPath: "/run/user/1000/docker.sock",
    });
  });

  test("parses a unix:// DOCKER_HOST", () => {
    expect(resolveDockerEndpoint({ DOCKER_HOST: "unix:///custom/docker.sock" })).toEqual({
      kind: "unix",
      socketPath: "/custom/docker.sock",
    });
  });

  test("parses a tcp:// DOCKER_HOST into a plain-HTTP base URL", () => {
    expect(resolveDockerEndpoint({ DOCKER_HOST: "tcp://socket-proxy:2375" })).toEqual({
      kind: "tcp",
      baseUrl: "http://socket-proxy:2375",
    });
  });

  test("uses Docker's default port when a tcp:// DOCKER_HOST has none", () => {
    expect(resolveDockerEndpoint({ DOCKER_HOST: "tcp://socket-proxy" })).toEqual({
      kind: "tcp",
      baseUrl: "http://socket-proxy:2375",
    });
  });

  test("DOCKER_HOST wins over DOCKER_SOCK", () => {
    const endpoint = resolveDockerEndpoint({
      DOCKER_HOST: "tcp://socket-proxy:2375",
      DOCKER_SOCK: "/var/run/docker.sock",
    });
    expect(endpoint.kind).toBe("tcp");
  });

  test("a blank DOCKER_HOST or DOCKER_SOCK means unset", () => {
    expect(resolveDockerEndpoint({ DOCKER_HOST: " ", DOCKER_SOCK: "" })).toEqual({
      kind: "unix",
      socketPath: "/var/run/docker.sock",
    });
  });

  test("rejects schemes DockRoute cannot speak", () => {
    for (const value of [
      "https://socket-proxy:2376",
      "ssh://user@host",
      "npipe:////./pipe/docker_engine",
      "socket-proxy:2375",
      "unix://relative.sock",
      "tcp://",
      "tcp://user:secret@socket-proxy:2375",
      "tcp://socket-proxy:2375?tls=1",
    ]) {
      expect(() => resolveDockerEndpoint({ DOCKER_HOST: value })).toThrow(/Invalid DOCKER_HOST/);
    }
  });

  test("does not echo credentials from a rejected DOCKER_HOST", () => {
    expect(() =>
      resolveDockerEndpoint({ DOCKER_HOST: "tcp://user:secret@socket-proxy:2375" }),
    ).toThrow(/^(?!.*secret).*tcp:\/\/\*\*\*@socket-proxy:2375/);
  });

  test.each([
    ["an @ in the password", "tcp://u:p@ss@socket-proxy:2375", "tcp://***@socket-proxy:2375"],
    ["a / in the password", "tcp://u:p/ss@socket-proxy:2375", "tcp://***@socket-proxy:2375"],
    ["no scheme", "u:p/ss@socket-proxy:2375", "***@socket-proxy:2375"],
  ])("masks the whole userinfo of a rejected DOCKER_HOST with %s", (_, value, masked) => {
    expect(() => resolveDockerEndpoint({ DOCKER_HOST: value })).toThrow(
      `Invalid DOCKER_HOST "${masked}"`,
    );
  });
});

describe("describeDockerEndpoint", () => {
  test("renders the endpoint the way DOCKER_HOST spells it", () => {
    expect(describeDockerEndpoint({ kind: "unix", socketPath: "/var/run/docker.sock" })).toBe(
      "unix:///var/run/docker.sock",
    );
    expect(describeDockerEndpoint({ kind: "tcp", baseUrl: "http://socket-proxy:2375" })).toBe(
      "tcp://socket-proxy:2375",
    );
  });
});
