---
name: dockroute-dev-practices
description: Development best practices for the dockroute codebase (Bun + TypeScript) — SOLID applied to the provider architecture, anti-corruption layer rules for external APIs (DNS providers, Docker Engine), and bun:test unit-testing patterns. Use this skill whenever writing or reviewing code in this repo — new providers, core changes, refactors, or tests — even if the user doesn't mention "best practices" explicitly.
---

# DockRoute Development Practices

DockRoute's core promise is being provider-agnostic: many DNS providers, one
core. Everything in this skill exists to protect that promise. Read
`ARCHITECTURE.md` first if you haven't.

## Anti-corruption layer (ACL) — the most important rule

The core domain model lives in `src/core/types.ts` (`DnsRecord`, etc.).
External systems — DNS provider APIs, the Docker Engine API — each have their
own vocabulary and payload shapes. Those shapes must NEVER leak into `src/core/`.

- Each provider translates between its wire format and `DnsRecord` **at its own
  boundary**, inside `src/providers/<name>.ts` (or `src/providers/<name>/`).
  Wire types (e.g. a Cloudflare API response interface) are declared there,
  not exported to the core.
- The same applies to Docker: raw Engine API payload types stay in
  `src/docker/`; the core consumes only domain types.
- If the core needs new information (e.g. record priority for MX), extend the
  domain model deliberately in `src/core/types.ts` — never by passing a
  provider's raw object through.
- Smell test: `src/core/` must compile with every file in `src/providers/`
  (except `provider.ts`) and `src/docker/client.ts` deleted. Imports only flow
  inward: providers/docker → core, never core → providers.

Why: the day a provider's API shape drives a core type, every other provider
inherits that provider's quirks, and adding provider N+1 means touching the core.

## SOLID, applied to this codebase

Don't recite SOLID — apply it where it pays off here:

- **S**: one module, one reason to change. Label parsing (`core/labels.ts`),
  reconciling (`core/reconciler.ts`), Docker transport (`docker/client.ts`) and
  provider logic stay separate. If a change to a provider forces edits in two
  of these, the boundary is wrong.
- **O**: new providers are added by creating a file and calling
  `registerProvider()` — never by editing a switch/if-chain in the core. Keep
  it that way for new extension points too (e.g. record sources beyond labels).
- **L**: every provider must be substitutable. If code somewhere does
  `if (provider.name === "cloudflare")`, the `Provider` interface is missing a
  capability — extend the interface instead.
- **I**: keep the `Provider` interface minimal. Optional capabilities
  (dry-run, batch limits, zone filtering) go in as optional members or
  separate small interfaces, not mandatory methods every provider must stub.
- **D**: the core depends on the `Provider` abstraction and receives
  dependencies via constructor (see `Reconciler`). Never `new` a concrete
  provider or Docker client inside core logic — wiring happens in
  `src/index.ts` only.

## Unit testing patterns (bun:test)

- Tests live next to the code: `foo.ts` → `foo.test.ts`. Run with `bun test`.
- Use `import { describe, test, expect } from "bun:test"`.
- Structure each test as Arrange–Act–Assert; name tests after behavior, not
  implementation: `test("skips containers without dockroute.enabled")`, not
  `test("recordsFromContainer returns []")`.
- **Prefer hand-written fakes over mocking frameworks.** The interfaces are
  small by design — a fake `Provider` that records the `DnsRecord[]` it
  received, or a fake Docker client returning canned `ContainerInfo[]`, is a
  few lines and keeps tests readable. See `src/core/labels.test.ts` for the
  house style, including small builder helpers like `container(labels)`.
- Test through public interfaces; don't export private helpers just to test
  them. If a helper is hard to reach, that's a design signal.
- Every provider needs contract-style tests: given a desired `DnsRecord[]`,
  assert the provider performs the right creates/updates/deletes against a
  fake of its API. Never hit real APIs in unit tests.
- Cover the unhappy paths that matter operationally: malformed labels,
  provider API errors, empty desired state (which implies deletions).

## Bun & TypeScript conventions

- Follow the root `CLAUDE.md`: Bun APIs over Node equivalents (`Bun.file`,
  `fetch` with `unix:`, `Bun.sleep`), no express/ws/dotenv.
- `strict` TypeScript; no `any` at boundaries — model wire payloads with
  explicit interfaces and validate/narrow at the edge (the ACL boundary is
  exactly where unknown data gets checked).
- Errors from external systems are expected, not exceptional: catch at the
  boundary, log with a `[component]` prefix (existing style), and keep the
  reconcile loop alive. Only configuration errors at startup may crash.
- Run `bun run typecheck` and `bun test` before considering any change done.
