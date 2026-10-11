# DockRoute

[DockRoute](https://github.com/Dockroute/Dockroute) is External-DNS for plain
Docker hosts. It watches your running containers, reads their `dockroute.*`
labels, and reconciles the matching DNS records — and Cloudflare Tunnel
routes — in a pluggable provider.

Your Docker labels are the source of truth; DockRoute makes the provider
match them. It never alters or deletes a record it cannot prove it manages,
because every record it creates is paired with an ownership TXT record in
the ExternalDNS style. That is what makes it safe to point at a zone you
also edit by hand.

DockRoute has no web interface. It is a background reconciler — check the
container logs to see what it is doing.

## Application Setup

1. Opt a container in with two labels on the services you want DockRoute to
   manage:
   - `dockroute.enabled=true`
   - `dockroute.hostname=app.example.com`
2. Leave the DNS provider on `log` first. It is a zero-credential dry run
   that only prints the DNS records DockRoute would create, so you can
   confirm the labels are right before anything reaches your zone.
3. When the log output looks correct, set the provider to `cloudflare` and
   fill in a Cloudflare API token with `Zone -> DNS -> Edit` permission (add
   `Account -> Cloudflare Tunnel -> Edit` if you also publish Cloudflare
   Tunnel routes).

## Docker socket access

DockRoute mounts `/var/run/docker.sock` read-only to watch container
start/stop events and labels. It only sends `GET` requests to `/_ping`,
`/containers/json` and `/events` — a `:ro` mount does not make the Docker
API itself read-only, see
[SECURITY.md](https://github.com/Dockroute/Dockroute/blob/main/SECURITY.md)
for the full threat model.
