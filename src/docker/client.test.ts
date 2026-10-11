import { afterEach, describe, expect, test } from "bun:test";
import { DockerClient } from "./client";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  init?: RequestInit & { unix?: string };
}

/** Hand-written fake for the Docker Engine API: records calls, replies canned. */
function fakeDockerApi(reply: (url: string) => Response = () => new Response("OK")) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: Call["init"]) => {
    calls.push({ url: String(url), init });
    return reply(String(url));
  }) as typeof fetch;
  return calls;
}

const tcp = new DockerClient({ kind: "tcp", baseUrl: "http://socket-proxy:2375" });
const unix = new DockerClient({ kind: "unix", socketPath: "/var/run/docker.sock" });

describe("DockerClient", () => {
  test("pings over the unix socket", async () => {
    const calls = fakeDockerApi();

    await unix.ping();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://docker/_ping");
    expect(calls[0]?.init?.unix).toBe("/var/run/docker.sock");
  });

  test("pings over tcp without a unix socket", async () => {
    const calls = fakeDockerApi();

    await tcp.ping();

    expect(calls[0]?.url).toBe("http://socket-proxy:2375/_ping");
    expect(calls[0]?.init?.unix).toBeUndefined();
  });

  test("lists running containers over tcp", async () => {
    const containers = [{ Id: "abc", Names: ["/whoami"], Labels: {} }];
    const calls = fakeDockerApi(() => Response.json(containers));

    const result = await tcp.listRunningContainers();

    expect(calls[0]?.url).toBe("http://socket-proxy:2375/containers/json");
    expect(result).toEqual(containers as never);
  });

  test("streams container events over tcp, forwarding the abort signal", async () => {
    const calls = fakeDockerApi(() => new Response(streamOf("{}\n", "{}\n")));
    const controller = new AbortController();

    const events = [];
    for await (const event of tcp.containerEvents(controller.signal)) events.push(event);

    const url = new URL(calls[0]?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("http://socket-proxy:2375/events");
    expect(JSON.parse(url.searchParams.get("filters") ?? "")).toEqual({
      type: ["container"],
      event: ["start", "die", "stop", "destroy"],
    });
    expect(calls[0]?.init?.signal).toBe(controller.signal);
    expect(events).toHaveLength(2);
  });

  test("only ever issues GET requests", async () => {
    const calls = fakeDockerApi((url) =>
      url.includes("/containers/json") ? Response.json([]) : new Response(""),
    );

    await tcp.ping();
    await tcp.listRunningContainers();
    for await (const _ of tcp.containerEvents()) {
    }

    for (const call of calls) expect(call.init?.method ?? "GET").toBe("GET");
  });

  test("surfaces the status of a failed request", async () => {
    fakeDockerApi(() => new Response("boom", { status: 500 }));

    await expect(tcp.ping()).rejects.toThrow("Docker API 500: boom");
  });

  test("hints at the proxy allowlist when a request is forbidden", async () => {
    fakeDockerApi(() => new Response("Forbidden", { status: 403 }));

    await expect(tcp.listRunningContainers()).rejects.toThrow(
      /socket proxy.*GET \/_ping, \/containers\/json and \/events/,
    );
  });
});

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}
