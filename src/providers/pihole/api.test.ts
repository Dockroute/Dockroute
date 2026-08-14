import { afterEach, describe, expect, test } from "bun:test";
import { PiholeFetchApi } from "./api";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  method: string;
  sid: string | null;
}

const AUTH_OK = { session: { valid: true, sid: "sid-1" } };

function stubFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown },
) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      method: init?.method ?? "GET",
      sid: new Headers(init?.headers).get("X-FTL-SID") || null,
    });
    if (u.endsWith("/api/auth")) return Response.json(AUTH_OK);
    const { status = 200, body = {} } = handler(u, init);
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
  }) as typeof fetch;
  return calls;
}

describe("PiholeFetchApi", () => {
  test("authenticates once and sends the session id on requests", async () => {
    const calls = stubFetch(() => ({ body: { config: { dns: { hosts: ["1.2.3.4 a.lan"] } } } }));
    const api = new PiholeFetchApi("http://pihole/", "pw");

    const hosts = await api.getHosts();
    await api.getHosts();

    expect(hosts).toEqual(["1.2.3.4 a.lan"]);
    expect(calls.map((c) => c.url)).toEqual([
      "http://pihole/api/auth",
      "http://pihole/api/config/dns/hosts",
      "http://pihole/api/config/dns/hosts",
    ]);
    expect(calls[1]?.sid).toBe("sid-1");
  });

  test("re-authenticates and retries once on 401", async () => {
    let denied = false;
    const calls = stubFetch(() => {
      if (!denied) {
        denied = true;
        return { status: 401, body: { error: { message: "unauthorized" } } };
      }
      return { body: { config: { dns: { hosts: [] } } } };
    });
    const api = new PiholeFetchApi("http://pihole", "pw");

    await api.getHosts();

    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "POST", "GET"]);
  });

  test("URL-encodes entries and accepts 204 responses", async () => {
    const calls = stubFetch(() => ({ status: 204 }));
    const api = new PiholeFetchApi("http://pihole", "pw");

    await api.deleteHost("1.2.3.4 a.lan");

    expect(calls.at(-1)?.url).toBe("http://pihole/api/config/dns/hosts/1.2.3.4%20a.lan");
    expect(calls.at(-1)?.method).toBe("DELETE");
  });

  test("adds CNAME entries via the cnameRecords endpoint", async () => {
    const calls = stubFetch(() => ({ status: 201, body: {} }));
    const api = new PiholeFetchApi("http://pihole", "pw");

    await api.addCnameRecord("a.lan,b.lan,300");

    expect(calls.at(-1)?.url).toBe("http://pihole/api/config/dns/cnameRecords/a.lan%2Cb.lan%2C300");
    expect(calls.at(-1)?.method).toBe("PUT");
  });

  test("surfaces Pi-hole error messages", async () => {
    stubFetch(() => ({ status: 400, body: { error: { message: "Invalid item" } } }));
    const api = new PiholeFetchApi("http://pihole", "pw");

    expect(api.addHost("bogus")).rejects.toThrow(/Invalid item/);
  });

  test("fails fast when authentication is rejected", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { session: { valid: false, sid: null } },
        { status: 401 },
      )) as unknown as typeof fetch;
    const api = new PiholeFetchApi("http://pihole", "bad");

    expect(api.getHosts()).rejects.toThrow(/PIHOLE_PASSWORD/);
  });
});
