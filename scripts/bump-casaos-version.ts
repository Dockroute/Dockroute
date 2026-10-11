// Writes the release version and date into the CasaOS template (#49).
//
// semantic-release runs this in its prepare step (see .releaserc.json), so the
// change lands in the same chore(release) commit as CHANGELOG.md. The template
// ships the image as :latest, which makes x-casaos.version the only version
// signal the CasaOS/ZimaOS store has for offering an upgrade.
//
// The edit is line-targeted on purpose: a YAML round trip would reflow the
// description/tips block scalars and turn every release into a large diff.

const DEFAULT_TEMPLATE = new URL(
  "../templates/casaos/dockroute/docker-compose.yml",
  import.meta.url,
);

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function bumpCasaosVersion(source: string, version: string, date: string): string {
  if (!SEMVER.test(version)) throw new Error(`Not a release version: ${version}`);
  if (!ISO_DATE.test(date)) throw new Error(`Not an ISO date (YYYY-MM-DD): ${date}`);

  const lines = source.split("\n");
  const start = lines.indexOf("x-casaos:");
  if (start === -1) throw new Error("No top-level x-casaos block in the template");

  // The block ends at the next line that starts at column 0. Only its direct
  // children (two-space indent) are candidates, so a "version:" inside a block
  // scalar or a nested map is never touched.
  const nextTopLevel = lines.findIndex((line, i) => i > start && /^\S/.test(line));
  const end = nextTopLevel === -1 ? lines.length : nextTopLevel;

  const replace = (key: string, value: string) => {
    const pattern = new RegExp(`^  ${key}:\\s`);
    const matches = lines.flatMap((line, i) =>
      i > start && i < end && pattern.test(line) ? [i] : [],
    );
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one x-casaos.${key} line, found ${matches.length}`);
    }
    lines[matches[0]!] = `  ${key}: "${value}"`;
  };

  replace("version", version);
  replace("update_at", date);
  return lines.join("\n");
}

if (import.meta.main) {
  const [version, path = DEFAULT_TEMPLATE.pathname] = Bun.argv.slice(2);
  if (!version) {
    console.error("usage: bun scripts/bump-casaos-version.ts <version> [template]");
    process.exit(1);
  }
  const date = new Date().toISOString().slice(0, 10);
  const file = Bun.file(path);
  await Bun.write(file, bumpCasaosVersion(await file.text(), version, date));
  console.log(`CasaOS template set to ${version} (${date})`);
}
