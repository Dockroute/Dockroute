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

- DockRoute needs read-only access to the Docker socket (`:ro` mount) and a
  DNS provider token. Grant the token the minimum scopes documented in the
  README (Zone → DNS → Edit; Account → Cloudflare Tunnel → Edit only when
  using tunnels).
- DockRoute never stores credentials; they are read from environment
  variables at startup.

## Supported versions

Pre-1.0: only the latest release receives fixes.
