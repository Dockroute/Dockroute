import { afterEach, describe, expect, test } from "bun:test";
import { CloudflareFetchApi } from "./api";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
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
      body: { success: false, errors: [{ code: 9109, message: "Invalid access token" }], result: null },
    }));

    expect(new CloudflareFetchApi("bad").listZones()).rejects.toThrow(/9109: Invalid access token/);
  });

  test("unwraps a null tunnel config", async () => {
    stubFetch(() => ({ body: { success: true, errors: [], result: { config: null } } }));

    const config = await new CloudflareFetchApi("token").getTunnelConfig("acc", "tun");

    expect(config).toBeNull();
  });
});
