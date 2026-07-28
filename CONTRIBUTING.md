# Contributing to DockRoute

Thanks for your interest! Contributions of all kinds are welcome: bug
reports, docs, code and design discussions.

## Development setup

DockRoute runs on [Bun](https://bun.sh) (no Node.js needed):

```sh
bun install
bun test            # unit tests
bun run typecheck   # strict TypeScript
bun run lint        # Biome (bun run lint:fix to auto-fix)
bun start           # run against your local Docker socket (provider=log)
```

All four must pass before a PR — CI enforces them.

## Ground rules

- **`main` stays clean** — all changes land via pull request.
- **The safety principle is non-negotiable:** DockRoute never modifies or
  deletes anything it cannot prove it manages (see
  [ARCHITECTURE.md](ARCHITECTURE.md)). PRs that weaken ownership or conflict
  checks will be asked to rework.
- **Anti-corruption layer:** provider wire types (Cloudflare payloads, Docker
  Engine payloads) never leak into `src/core/`. Each provider translates at
  its own boundary. `src/core/` must compile with every provider deleted.
- **Tests come with the change:** new providers need contract-style tests
  against an in-memory fake of their API — unit tests never hit real HTTP.
  House style: hand-written fakes, Arrange–Act–Assert, behavior-named tests
  (see `src/core/labels.test.ts`).
- English only in code, comments, commits and docs.

## Adding a DNS provider

1. Create `src/providers/<name>/` with the wire client and the provider.
2. Reuse `src/providers/registry/` (ownership + planner) — the safety rules
   live there and must behave identically across providers.
3. Register via `registerProvider("<name>", (config) => ...)` — no
   switch/if-chains in the core.
4. Import it in `src/index.ts` and document labels/env vars in the README.

## Commit / PR conventions

- Conventional-style prefixes appreciated: `feat:`, `fix:`, `docs:`,
  `chore:`, `test:`.
- Keep PRs focused; describe *why*, not just *what*.
