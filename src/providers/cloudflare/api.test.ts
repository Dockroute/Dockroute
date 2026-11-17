import { afterEach, describe, expect, test } from "bun:test";
import { CloudflareFetchApi } from "./api";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body: unknown },
) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    const { status = 200, body } = handler(u, init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

describe("CloudflareFetchApi", () => {
  test("consumes every page when listing", async () => {
    const calls = stubFetch((url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return {
        body: {
          success: true,
          errors: [],
          result: [{ id: `z${page}`, name: `zone${page}.com` }],
          result_info: { page, total_pages: 3 },
        },
      };
    });

    const zones = await new CloudflareFetchApi("token").listZones();

    expect(zones.map((z) => z.id)).toEqual(["z1", "z2", "z3"]);
    expect(calls).toHaveLength(3);
  });

  test("listDnsRecords GETs the zone dns_records path", async () => {
    const calls = stubFetch(() => ({
      body: {
        success: true,
        errors: [],
        result: [{ id: "r1", type: "A", name: "a.example.com", content: "1.2.3.4", ttl: 300 }],
        result_info: { page: 1, total_pages: 1 },
      },
    }));

    const records = await new CloudflareFetchApi("token").listDnsRecords("zone-1");

    expect(records).toHaveLength(1);
    expect(calls[0]).toContain("/zones/zone-1/dns_records?");
  });

  test("sends the bearer token", async () => {
    let auth: string | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      auth = new Headers(init?.headers).get("Authorization") ?? undefined;
      return new Response(JSON.stringify({ success: true, errors: [], result: [] }));
    }) as typeof fetch;

    await new CloudflareFetchApi("secret-token").listZones();

    expect(auth).toBe("Bearer secret-token");
  });

  test("surfaces Cloudflare error messages", async () => {
    stubFetch(() => ({
      status: 403,
      body: {
        success: false,
        errors: [{ code: 9109, message: "Invalid access token" }],
        result: null,
      },
    }));

    expect(new CloudflareFetchApi("bad").listZones()).rejects.toThrow(/9109: Invalid access token/);
  });

  test("includes HTTP status when Cloudflare returns success:false with empty errors", async () => {
    stubFetch(() => ({
      status: 500,
      body: { success: false, errors: [], result: null },
    }));

    expect(new CloudflareFetchApi("token").listZones()).rejects.toThrow(/HTTP 500/);
  });

  test("unwraps a null tunnel config", async () => {
    stubFetch(() => ({ body: { success: true, errors: [], result: { config: null } } }));

    const config = await new CloudflareFetchApi("token").getTunnelConfig("acc", "tun");

    expect(config).toBeNull();
  });

  test("createDnsRecord POSTs the record body to the zone path", async () => {
    let method: string | undefined;
    let body: unknown;
    let url = "";
    stubFetch((u, init) => {
      url = u;
      method = init?.method;
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return { body: { success: true, errors: [], result: null } };
    });

    const record = {
      type: "A",
      name: "app.example.com",
      content: "203.0.113.10",
      ttl: 300,
      proxied: false,
    };
    await new CloudflareFetchApi("token").createDnsRecord("zone-1", record);

    expect(method).toBe("POST");
    expect(url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/dns_records");
    expect(body).toEqual(record);
  });

  test("updateDnsRecord PUTs the record body to the record path", async () => {
    let method: string | undefined;
    let body: unknown;
    let url = "";
    stubFetch((u, init) => {
      url = u;
      method = init?.method;
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return { body: { success: true, errors: [], result: null } };
    });

    const record = {
      type: "CNAME",
      name: "www.example.com",
      content: "origin.example.com",
      ttl: 120,
    };
    await new CloudflareFetchApi("token").updateDnsRecord("zone-1", "rec-9", record);

    expect(method).toBe("PUT");
    expect(url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/rec-9");
    expect(body).toEqual(record);
  });

  test("deleteDnsRecord DELETEs the record path with no body", async () => {
    let method: string | undefined;
    let body: unknown;
    let url = "";
    stubFetch((u, init) => {
      url = u;
      method = init?.method;
      body = init?.body;
      return { body: { success: true, errors: [], result: null } };
    });

    await new CloudflareFetchApi("token").deleteDnsRecord("zone-1", "rec-9");

    expect(method).toBe("DELETE");
    expect(url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/rec-9");
    expect(body).toBeUndefined();
  });

  test("putTunnelConfig PUTs a body wrapped as { config }", async () => {
    let method: string | undefined;
    let body: unknown;
    let url = "";
    stubFetch((u, init) => {
      url = u;
      method = init?.method;
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return { body: { success: true, errors: [], result: null } };
    });

    const config = {
      ingress: [{ hostname: "app.example.com", service: "http://localhost:80" }],
    };
    await new CloudflareFetchApi("token").putTunnelConfig("acc", "tun", config);

    expect(method).toBe("PUT");
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc/cfd_tunnel/tun/configurations",
    );
    expect(body).toEqual({ config });
  });
});
