#!/bin/sh
# Zero-config Docker socket access: when the container starts as root, grant
# the app user the group that owns the mounted Docker socket, then drop
# privileges before exec'ing the app. Started as any other user (compose
# `user:` override), the script is a no-op passthrough.
set -eu

SOCK="${DOCKER_SOCK:-/var/run/docker.sock}"

if [ "$(id -u)" = "0" ]; then
  if [ -S "$SOCK" ]; then
    sock_gid="$(stat -c '%g' "$SOCK")"
    exec setpriv --reuid bun --regid bun --groups "$sock_gid" -- "$@"
  fi
  exec setpriv --reuid bun --regid bun --clear-groups -- "$@"
fi

exec "$@"
