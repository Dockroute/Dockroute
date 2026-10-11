# Security Policy

DockRoute handles DNS provider credentials and talks to the Docker socket,
so we take reports seriously.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Instead use
GitHub's private vulnerability reporting
(*Security → Report a vulnerability* on the repository), or email
`danilo.dorgam@codeinloop.com.br`.

You can expect an acknowledgement within a few days. Please include steps to
reproduce and the impact you foresee.

## Scope notes

- DockRoute needs access to the Docker socket and a DNS provider token.
  It only sends `GET` requests to `/_ping`, `/containers/json` and `/events`.
  Note that a `:ro` socket mount does **not** make the Docker API read-only:
  whoever can open the socket can call any endpoint, so treat socket access as
  privileged. To restrict DockRoute to only these endpoints, run it behind a
  socket proxy with `DOCKER_HOST=tcp://…` (see "Hardened setup" in the README).
- Grant the DNS provider token the minimum scopes documented in the
  README (Zone → DNS → Edit; Account → Cloudflare Tunnel → Edit only when
  using tunnels).
- DockRoute never stores credentials; they are read from environment
  variables at startup.

## Supported versions

Pre-1.0: only the latest release receives fixes.
