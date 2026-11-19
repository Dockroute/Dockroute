import { describe, expect, test } from "bun:test";
import { dirname, relative, resolve, sep } from "node:path";

// ARCHITECTURE.md: src/core/ must compile with every provider deleted. This
// turns that rule into a test: every module specifier in a core file must be
// relative and stay inside src/core/, or use the node: or bun: scheme.
//
// The specifiers are read from the source text rather than with
// Bun.Transpiler#scanImports, which drops type-only imports, and a type-only
// import of a provider wire type is exactly the leak this rule forbids.

const CORE_DIR = import.meta.dir;

// `import … from "x"`, `import type … from "x"`, `export … from "x"` and
// `export type … from "x"`, including multi-line braces.
const FROM = /(?:^|[\s;])(?:import|export)\s[^'"`;]*?\bfrom\s*(["'])([^"'\n]+)\1/g;
// Side-effect `import "x"`.
//
// Both need whitespace, a semicolon or the start of a line before the keyword,
// so the sample imports inside template literals in this file's own tests
// (preceded by a backtick) are not read as imports of this file.
const BARE = /(?:^|[\s;])import\s*(["'])([^"'\n]+)\1/g;

function moduleSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [FROM, BARE]) {
    for (const match of source.matchAll(pattern)) {
      found.push(match[2] as string);
    }
  }
  return found;
}

function isAllowed(file: string, specifier: string): boolean {
  if (specifier.startsWith("node:") || specifier.startsWith("bun:")) {
    return true;
  }
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return false;
  }
  const target = resolve(dirname(file), specifier);
  return target === CORE_DIR || target.startsWith(CORE_DIR + sep);
}

describe("core import boundary", () => {
  test("every core file imports only from src/core/, node: or bun:", async () => {
    // Arrange
    const files: string[] = [];
    for await (const path of new Bun.Glob("**/*.ts").scan({ cwd: CORE_DIR, absolute: true })) {
      files.push(path);
    }

    // Act
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of moduleSpecifiers(await Bun.file(file).text())) {
        if (!isAllowed(file, specifier)) {
          violations.push(`${relative(CORE_DIR, file)} imports ${specifier}`);
        }
      }
    }

    // Assert
    expect(files.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  test("reads every import and re-export form, type-only ones included", () => {
    // Arrange
    const source = [
      `import { a } from "./a";`,
      `import type { CfDnsRecord } from "../providers/cloudflare/api";`,
      `import {\n  b,\n  type C,\n} from '../providers/log';`,
      `import * as net from "node:net";`,
      `import d, { e } from "./d";`,
      `export { f } from "./f";`,
      `export type { G } from "../docker/types";`,
      `export * from "./h";`,
      `import "../providers/side-effect";`,
      `const notAnImport = "from here";`,
    ].join("\n");

    // Act
    const specifiers = moduleSpecifiers(source);

    // Assert
    expect(specifiers.sort()).toEqual(
      [
        "./a",
        "../providers/cloudflare/api",
        "../providers/log",
        "node:net",
        "./d",
        "./f",
        "../docker/types",
        "./h",
        "../providers/side-effect",
      ].sort(),
    );
  });

  test("rejects bare packages and relative paths that leave src/core/", () => {
    // Arrange
    const file = resolve(CORE_DIR, "labels.ts");

    // Act + Assert
    expect(isAllowed(file, "./types")).toBe(true);
    expect(isAllowed(file, "../core/types")).toBe(true);
    expect(isAllowed(file, "node:net")).toBe(true);
    expect(isAllowed(file, "bun:test")).toBe(true);
    expect(isAllowed(file, "../providers/log")).toBe(false);
    expect(isAllowed(file, "../core-extra/x")).toBe(false);
    expect(isAllowed(file, "dockerode")).toBe(false);
  });
});
