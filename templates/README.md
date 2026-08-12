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
