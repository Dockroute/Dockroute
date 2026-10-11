import { describe, expect, test } from "bun:test";
import { logStartupBanner } from "./banner";

describe("logStartupBanner", () => {
  test("logs exactly one line with the version, the repo link and a star request", () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);

    logStartupBanner(log, "1.2.3");

    expect(lines).toEqual([
      "DockRoute v1.2.3 · https://github.com/Dockroute/Dockroute · ⭐ Star us if it saves you time",
    ]);
  });

  test("defaults to the version declared in package.json", async () => {
    const { version } = await Bun.file(new URL("../package.json", import.meta.url)).json();
    const lines: string[] = [];

    logStartupBanner((line) => lines.push(line));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`DockRoute v${version} · `);
  });
});
