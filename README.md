# dockroute

[![CI](https://github.com/Dockroute/Dockroute/actions/workflows/ci.yml/badge.svg)](https://github.com/Dockroute/Dockroute/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Dockroute/Dockroute/actions/workflows/codeql.yml/badge.svg)](https://github.com/Dockroute/Dockroute/actions/workflows/codeql.yml)
[![codecov](https://codecov.io/gh/Dockroute/Dockroute/branch/main/graph/badge.svg)](https://codecov.io/gh/Dockroute/Dockroute)
[![Release](https://img.shields.io/github/v/release/Dockroute/Dockroute?include_prereleases)](https://github.com/Dockroute/Dockroute/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

External-DNS for plain Docker hosts: dockroute watches your running
containers, reads `dockroute.*` labels and reconciles the matching DNS
records — and Cloudflare Tunnel routes — in a pluggable provider.

Your Docker Compose file is the source of truth; dockroute makes the
provider match it, and **never alters what it cannot prove it manages**
(ExternalDNS-style TXT ownership).

> Status: MVP + Cloudflare + Pi-hole. DNS records, TXT ownership, sync policies,
> Cloudflare Tunnel routes and Pi-hole local DNS work end to end.
> See [ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start

Label a container:

```yaml
services:
  whoami:
    image: traefik/whoami
    labels:
      dockroute.enabled: "true"
      dockroute.hostname: "whoami.example.com"
      # publish through an existing Cloudflare Tunnel:
      dockroute.tunnel.service: "http://whoami:80"
```

Run dockroute next to it:

```yaml
services:
  dockroute:
    image: ghcr.io/dockroute/dockroute:latest
    environment:
      DOCKROUTE_PROVIDER: cloudflare
      DOCKROUTE_OWNER_ID: home-lab
      CLOUDFLARE_API_TOKEN: ${CLOUDFLARE_API_TOKEN}
      # only needed for tunnel publishing:
      CLOUDFLARE_ACCOUNT_ID: ${CLOUDFLARE_ACCOUNT_ID}
      CLOUDFLARE_TUNNEL_ID: ${CLOUDFLARE_TUNNEL_ID}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    # No user/group setup needed: the entrypoint detects the socket's group,
    # grants it to the app user and drops privileges before starting.
```

Or start with the zero-credential dry run:

```sh
bun install
DOCKROUTE_DEFAULT_TARGET=192.168.1.10 bun start   # provider=log by default
```

## Labels

| Label                          | Required | Default                    | Description                       |
| ------------------------------ | -------- | -------------------------- | --------------------------------- |
| `dockroute.enabled`            | yes      | —                          | `true` opts the container in      |
| `dockroute.hostname`           | yes      | —                          | FQDN(s), comma-separated          |
| `dockroute.type`               | no       | `A`                        | `A`, `AAAA` or `CNAME`            |
| `dockroute.target`             | no       | `DOCKROUTE_DEFAULT_TARGET` | Record value (IP or CNAME target) |
| `dockroute.ttl`                | no       | `300`                      | TTL in seconds                    |
| `dockroute.tunnel.service`     | no       | —                          | Origin URL; publish via Cloudflare Tunnel instead of a plain record |
| `dockroute.cloudflare.proxied` | no       | `false`                    | Proxy plain records through Cloudflare |

## Configuration

| Variable                   | Default                | Description                             |
| -------------------------- | ---------------------- | --------------------------------------- |
| `DOCKER_SOCK`              | `/var/run/docker.sock` | Docker Engine socket path               |
| `DOCKROUTE_PROVIDER`       | `log`                  | `log` (dry-run), `cloudflare` or `pihole` |
| `DOCKROUTE_DEFAULT_TARGET` | —                      | Fallback target when label is omitted   |
| `DOCKROUTE_RESYNC_SECONDS` | `60`                   | Interval of the periodic full reconcile |
| `DOCKROUTE_OWNER_ID`       | `default`              | Ownership id — lets several instances share a zone safely |
| `DOCKROUTE_POLICY`         | `sync`                 | `sync`, `upsert-only` or `create-only`  |
| `DOCKROUTE_TXT_PREFIX`     | `_dockroute-`          | Ownership TXT name prefix               |
| `DOCKROUTE_DOMAIN_FILTER`  | —                      | Comma-separated zone allowlist          |
| `CLOUDFLARE_API_TOKEN`     | —                      | Token with Zone→DNS→Edit (+ Account→Cloudflare Tunnel→Edit for tunnels) |
| `CLOUDFLARE_ACCOUNT_ID`    | —                      | For tunnel publishing                   |
| `CLOUDFLARE_TUNNEL_ID`     | —                      | For tunnel publishing (existing tunnel, you run `cloudflared`) |
| `PIHOLE_URL`               | —                      | Pi-hole v6 base URL, e.g. `http://192.168.1.5` |
| `PIHOLE_PASSWORD`          | —                      | Pi-hole app password (Settings → Web interface / API) |

## Pi-hole: intranet-only DNS (split-horizon)

Some services should resolve only inside your LAN. Point a DockRoute
instance at Pi-hole's local DNS ([v6 API](https://docs.pi-hole.net/api/)):

```yaml
services:
  dockroute-lan:
    image: ghcr.io/dockroute/dockroute:latest
    environment:
      DOCKROUTE_PROVIDER: pihole
      PIHOLE_URL: http://192.168.1.5
      PIHOLE_PASSWORD: ${PIHOLE_PASSWORD}
      DOCKROUTE_DOMAIN_FILTER: home.lan   # required for pihole
      DOCKROUTE_DEFAULT_TARGET: 192.168.1.10
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

Containers labeled with a `home.lan` hostname get an A/AAAA hosts entry (or
CNAME) in Pi-hole; anything outside the filter is skipped. For split-horizon,
run a second instance with `DOCKROUTE_PROVIDER=cloudflare` for your public
domain — each instance only touches hostnames matching its own filter.

Pi-hole cannot store TXT records, so the ownership model differs from the
other providers: `DOCKROUTE_DOMAIN_FILTER` is **required** and DockRoute
assumes it is the *only* writer for hostnames under the filtered domains —
manually created entries there will be removed under the default `sync`
policy. Entries outside the filter (and multi-hostname entries like
`ip host1 host2`) are never touched. A/AAAA TTLs are ignored (Pi-hole hosts
entries have none); CNAME TTLs are honored. Tunnel labels are skipped with a
warning.

## Safety model

- Every record dockroute creates gets a companion TXT record
  (`_dockroute-a.whoami.example.com`) carrying its owner id.
- Records without that proof of ownership are **never** modified, deleted or
  adopted — conflicts are logged and skipped.
- Orphan cleanup (container gone → records removed) only happens under the
  default `sync` policy and only for records this instance owns.
- Tunnel ingress rules that dockroute did not create are preserved verbatim;
  dockroute assumes it is the only automated writer for the tunnels it manages.

## Development

```sh
bun install
bun test            # unit tests (in-memory fakes, no real HTTP)
bun run typecheck   # strict TypeScript
bun run lint        # Biome — bun run lint:fix to auto-fix
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the ground rules (ownership
safety, anti-corruption layer, testing style) and how to add a provider.

## License

[MIT](LICENSE)
