# Store / catalog templates

Deployment templates for community app catalogs. The image they reference is
`ghcr.io/dockroute/dockroute:latest` (multi-arch: amd64 + arm64), published by
the release workflow.

## Portainer — `portainer/dockroute.json`

App template in [v3 format](https://docs.portainer.io/advanced/app-templates/format).

- **Self-hosted:** point Portainer's *App Templates URL* at
  `https://raw.githubusercontent.com/Dockroute/Dockroute/main/templates/portainer/dockroute.json`.
- **Distribution:** submit the template entry to the
  [Lissy93/portainer-templates](https://github.com/Lissy93/portainer-templates)
  aggregator (widely used community source).

## Unraid Community Apps — `unraid/dockroute.xml`

Container template for Unraid's Community Applications plugin.

Submission: CA requires templates to live in a dedicated template repository
listed with the CA team — copy this file into that repo and follow
[the CA application process](https://forums.unraid.net/topic/57181-docker-faq/).

## Arcane — `arcane/dockroute/`

Template folder matching the
[getarcaneapp/templates](https://github.com/getarcaneapp/templates)
contribution layout (`compose.yaml`, `.env.example`, `template.json`,
`README.md`).

Submitted upstream: [getarcaneapp/templates#168](https://github.com/getarcaneapp/templates/pull/168).
Their build generates `registry.json` automatically on merge — never edit it
by hand. Keep this folder in sync with the upstream copy.

## CasaOS / ZimaOS — `casaos/dockroute/`

App folder for the [ZimaOS/CasaOS AppStore v2
protocol](https://github.com/IceWhaleTech/CasaOS-AppStore/blob/main/docs/specs/compose-and-x-casaos.md):
one `docker-compose.yml` carrying a top-level `x-casaos` metadata block, plus
the icon asset. CasaOS and ZimaOS share this format and the same catalog, so a
single folder covers both.

DockRoute is headless, so the compose omits `ports`, `port_map` and `scheme`,
following the other background apps in that catalog (DuckDNS, playit-agent).
The build strips the per-service `x-casaos` block (it is v1 legacy) and moves
everything except `id`, `main`, `icon`, `title` and `version` into `meta.json`.

- **Self-hosted:** serve a built `dist/` and add its URL under *App Store →
  Add* in CasaOS or ZimaOS.
- **Distribution:** copy this folder to `Apps/DockRoute/` in a fork of
  [IceWhaleTech/CasaOS-AppStore](https://github.com/IceWhaleTech/CasaOS-AppStore)
  and open a PR. Upstream requires the app to be tested on a real CasaOS or
  ZimaOS install first, and CI runs `docker compose config -q` plus the
  `x-casaos.id` reverse-domain check.

Bump `x-casaos.version` and `update_at` on each release so the store can offer
the upgrade.

Validate locally from a checkout of that repository:

```sh
cp -r templates/casaos/dockroute/. <appstore>/Apps/DockRoute/
cd <appstore>
python3 .github/actions/validate-compose/scripts/validate_compose.py --app-path DockRoute --report-json report.json
./scripts/build_dist.sh
```

## Runtipi — `runtipi/dockroute/`

App folder for a [Runtipi](https://runtipi.io/) app store, in the native
`x-runtipi` compose format ([runtipi/runtipi-appstore](https://github.com/runtipi/runtipi-appstore)
migrated away from the older `docker-compose.json` "dynamic config" format via
their [native-docker codemod](https://github.com/runtipi/runtipi-appstore/tree/master/codemods/native-docker),
so this folder follows the current shape instead of the legacy one):
`config.json`, `docker-compose.yml` with a top-level and per-service
`x-runtipi` block, and `metadata/{description.md,logo.jpg}`.

DockRoute is headless, so `no_gui` and `exposable` are both `false` in
`config.json`, following the other background agents in that catalog (Duck
DNS, Beszel Agent). Runtipi still requires a reserved `internal_port` on the
main service even for a headless app; it is never actually published.

- **Self-hosted:** the **official `runtipi-appstore` is closed to new
  applications** ("no new applications will be accepted", see their
  [README](https://github.com/runtipi/runtipi-appstore#how-to-add-addtionals-apps)).
  The supported path for a new app like DockRoute is a user-added store, not
  a PR to the official one:
  - **Add custom app:** a Runtipi user points the *Add custom app* feature at
    this folder's raw URLs.
  - **Your own app store:** copy this folder into a repo laid out per
    [Create your own app store](https://runtipi.io/docs/guides/create-your-own-app-store)
    and add that store's URL under *App Store → Add* in Runtipi.
- **Distribution:** no upstream PR for this one — the catalog does not take
  new submissions. Revisit if Runtipi reopens submissions or ships a
  community-store aggregator.

Validate `config.json` against the schema, and `docker-compose.yml` against
the native format, from a checkout of `runtipi/runtipi-appstore`:

```sh
cp -r templates/runtipi/dockroute <runtipi-appstore>/apps/dockroute
cd <runtipi-appstore>
bun install
bun run test   # bun test && bun run scripts/validate-json.js
```
