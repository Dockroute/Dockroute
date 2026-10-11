import { describe, expect, test } from "bun:test";
import { bumpCasaosVersion } from "./bump-casaos-version";

const TEMPLATE = new URL("../templates/casaos/dockroute/docker-compose.yml", import.meta.url);

const compose = `services:
  dockroute:
    image: ghcr.io/dockroute/dockroute:latest
    x-casaos:
      envs:
        - container: DOCKROUTE_PROVIDER
x-casaos:
  description:
    en_us: |
      Line one.

      version: "9.9.9" inside a block scalar stays untouched.
  version: "0.4.0"
  update_at: "2026-08-24"
  website: "https://www.dockroute.dev"
`;

describe("bumpCasaosVersion", () => {
  test("rewrites the store version and update date of the top-level x-casaos block", () => {
    const result = bumpCasaosVersion(compose, "1.2.3", "2026-10-11");

    expect(result).toContain('  version: "1.2.3"\n  update_at: "2026-10-11"\n');
  });

  test("changes those two lines and nothing else", () => {
    const before = compose.split("\n");

    const after = bumpCasaosVersion(compose, "1.2.3", "2026-10-11").split("\n");

    const changed = after.flatMap((line, i) => (line === before[i] ? [] : [i]));
    expect(after).toHaveLength(before.length);
    expect(changed.map((i) => before[i])).toEqual([
      '  version: "0.4.0"',
      '  update_at: "2026-08-24"',
    ]);
  });

  test("is a no-op when the template already carries the release", () => {
    const once = bumpCasaosVersion(compose, "1.2.3", "2026-10-11");

    expect(bumpCasaosVersion(once, "1.2.3", "2026-10-11")).toBe(once);
  });

  test("fails instead of shipping a stale template when a field is missing", () => {
    const withoutDate = compose.replace('  update_at: "2026-08-24"\n', "");

    expect(() => bumpCasaosVersion(withoutDate, "1.2.3", "2026-10-11")).toThrow(/update_at/);
  });

  test("fails when there is no top-level x-casaos block", () => {
    const serviceOnly = compose.slice(0, compose.indexOf("x-casaos:\n  description"));

    expect(() => bumpCasaosVersion(serviceOnly, "1.2.3", "2026-10-11")).toThrow(/x-casaos/);
  });

  test("rejects a version or date that would break the quoted YAML scalar", () => {
    expect(() => bumpCasaosVersion(compose, '1.2.3"', "2026-10-11")).toThrow(/version/);
    expect(() => bumpCasaosVersion(compose, "1.2.3", "11/10/2026")).toThrow(/date/);
  });

  test("keeps the real template valid YAML with the new values", async () => {
    const source = await Bun.file(TEMPLATE).text();

    const parsed = Bun.YAML.parse(bumpCasaosVersion(source, "1.2.3", "2026-10-11")) as {
      "x-casaos": { version: string; update_at: string };
    };

    expect(parsed["x-casaos"].version).toBe("1.2.3");
    expect(parsed["x-casaos"].update_at).toBe("2026-10-11");
  });
});
