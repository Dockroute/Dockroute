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

> Status: MVP + Cloudflare. DNS records, TXT ownership, sync policies and
> Cloudflare Tunnel routes work end to end. See [ARCHITECTURE.md](ARCHITECTURE.md).

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
| `dockroute.target`             | no       | `DOCKROUTE_DEFAULT_TARGET` | Record value; must match `dockroute.type` (IPv4 / IPv6 / hostname) |
| `dockroute.ttl`                | no       | `300`                      | TTL in seconds                    |
| `dockroute.tunnel.service`     | no       | —                          | Origin URL; publish via Cloudflare Tunnel instead of a plain record |
| `dockroute.cloudflare.proxied` | no       | `false`                    | Proxy plain records through Cloudflare |

## Configuration

| Variable                   | Default                | Description                             |
| -------------------------- | ---------------------- | --------------------------------------- |
| `DOCKER_SOCK`              | `/var/run/docker.sock` | Docker Engine socket path               |
| `DOCKROUTE_PROVIDER`       | `log`                  | `log` (dry-run) or `cloudflare`         |
| `DOCKROUTE_DEFAULT_TARGET` | —                      | Fallback target when label is omitted   |
| `DOCKROUTE_RESYNC_SECONDS` | `60`                   | Interval of the periodic full reconcile |
| `DOCKROUTE_OWNER_ID`       | `default`              | Ownership id — lets several instances share a zone safely |
| `DOCKROUTE_POLICY`         | `sync`                 | `sync`, `upsert-only` or `create-only`  |
| `DOCKROUTE_DELETE_GRACE_SECONDS` | `60`             | How long a record must stay gone before it is deleted (`0` = delete at once) |
| `DOCKROUTE_TXT_PREFIX`     | `_dockroute-`          | Ownership TXT name prefix               |
| `DOCKROUTE_DOMAIN_FILTER`  | —                      | Comma-separated zone allowlist          |
| `CLOUDFLARE_API_TOKEN`     | —                      | Token with Zone→DNS→Edit (+ Account→Cloudflare Tunnel→Edit for tunnels) |
| `CLOUDFLARE_ACCOUNT_ID`    | —                      | For tunnel publishing                   |
| `CLOUDFLARE_TUNNEL_ID`     | —                      | For tunnel publishing (existing tunnel, you run `cloudflared`) |

## Safety model

- Every record dockroute creates gets a companion TXT record
  (`_dockroute-a.whoami.example.com`) carrying its owner id.
- Records without that proof of ownership are **never** modified, deleted or
  adopted — conflicts are logged and skipped.
- Orphan cleanup (container gone → records removed) only happens under the
  default `sync` policy and only for records this instance owns.
- Deletions wait out `DOCKROUTE_DELETE_GRACE_SECONDS` (default 60) of
  continuous absence, so a container restart does not take the hostname down.
  Creates and updates stay immediate: they are cheap and self-correcting,
  while a deleted record leaves a failure cached far beyond the outage.
  Raise it if your stacks pull images before starting.
- Tunnel ingress rules that dockroute did not create are preserved verbatim;
  dockroute assumes it is the only automated writer for the tunnels it manages.

## Troubleshooting

DockRoute skips a misconfigured or conflicting entry instead of stopping the
whole reconcile. Match the warning in `docker logs dockroute` to the table
below, fix that entry, and the next reconcile will try it again.

| Log message | What it means | What to do |
| ----------- | ------------- | ---------- |
| `[labels] <container>: dockroute.enabled but no dockroute.hostname, skipping` | The container opted in without a usable hostname. | Add a non-empty `dockroute.hostname` label. |
| `[labels] <container>: dockroute.tunnel.service set, ignoring dockroute.type/dockroute.target` | Tunnel publishing is enabled, so the plain-record type and target labels are unused. | Remove `dockroute.type` and `dockroute.target`, or remove `dockroute.tunnel.service` if a plain DNS record was intended. |
| `[labels] <container>: invalid dockroute.tunnel.service "<service>" (expected http://, https://, tcp://, ssh://), skipping` | The tunnel origin is not a valid URL with a supported scheme. | Set `dockroute.tunnel.service` to a complete `http://`, `https://`, `tcp://` or `ssh://` URL. |
| `[labels] <container>: unsupported record type "<type>", skipping` | `dockroute.type` is not supported. | Set it to `A`, `AAAA` or `CNAME`. |
| `[labels] <container>: no dockroute.target and no default target, skipping` | A plain DNS record has no target. | Add `dockroute.target` or set `DOCKROUTE_DEFAULT_TARGET`. |
| `[labels] <container>: dockroute.target "<target>" is not a valid <requirement>, skipping` | The target does not match `dockroute.type`: `A` needs an IPv4 address, `AAAA` an IPv6 address, and `CNAME` a hostname rather than an IP. | Correct `dockroute.target`, or `DOCKROUTE_DEFAULT_TARGET` when the container inherits it, or set `dockroute.type` to the type that matches the value. |
| `[labels] <container>: invalid dockroute.ttl "<ttl>", using 300` | The TTL is not a positive number, so DockRoute falls back to 300 seconds. | Set `dockroute.ttl` to a positive numeric value, or omit it to use the default. |
| `[reconciler] duplicate desired entry <type>:<hostname>: first container wins, skipping entry from <source>` | More than one container claims the same hostname and record type. | Keep that claim on one container only; the first container in the reconcile wins. |
| `[reconciler] duplicate hostname <hostname>: already published via tunnel, skipping <type> record from <source>` | The same hostname is requested as both a tunnel route and a plain DNS record. | Choose one publication method and remove the duplicate claim; the tunnel route wins the reconcile. |
| `[cloudflare] <hostname>: no matching zone, skipping` | None of the Cloudflare zones visible after `DOCKROUTE_DOMAIN_FILTER` matches the hostname. | Check the hostname, `DOCKROUTE_DOMAIN_FILTER`, and that the API token can access the intended zone. |
| `[cloudflare] conflict on <type> <hostname>: <reason> — skipping` | A pre-existing DNS record or ownership TXT proves the record is unmanaged or belongs to another owner. | Resolve the pre-existing record or ownership TXT deliberately: remove it if safe so DockRoute can recreate it, or use the owning DockRoute instance/owner id. Do not weaken the ownership check. |
| `[cloudflare] <N> tunnel route(s) requested but CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_TUNNEL_ID are not set — skipping tunnel sync` | Tunnel labels are present but DockRoute cannot identify the Cloudflare account and tunnel. | Set both `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_TUNNEL_ID`, or remove the tunnel labels. |
| `[cloudflare] tunnel route <hostname>: an unmanaged ingress rule claims this hostname — skipping` | The existing tunnel configuration already has an ingress rule for that hostname that DockRoute cannot prove it manages. | Remove or rename the pre-existing rule if it is safe to do so, or stop asking DockRoute to publish the same hostname. |

Ownership conflicts are a safety feature, not an adoption failure. In
particular, a data record with no DockRoute ownership TXT, or a record/TXT
owned by a different `DOCKROUTE_OWNER_ID`, is skipped by design. A dangling
ownership TXT from another owner is treated the same way. Resolve the existing
record or ownership deliberately; do not bypass the ownership checks.

Docker socket preflight errors already include their remedy in the error text.
If the socket is missing, is not a Unix socket, or cannot be read, follow the
mount, `DOCKER_SOCK`, or group-access instruction printed with that error.

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
