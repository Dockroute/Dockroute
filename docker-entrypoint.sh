#!/bin/sh
# Zero-config Docker socket access: when the container starts as root, grant
# the app user the group that owns the mounted Docker socket, then drop
# privileges before exec'ing the app. The socket's group is only handed out
# when DOCKER_HOST is unset or unix://…; tcp:// (socket proxy mode) or any
# other value fails closed and the app never gets it. Values are trimmed the
# same way the app trims them. Started as any other user (compose `user:`
# override), the script is a no-op passthrough.
set -eu

trim() {
  value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  printf '%s' "${value%"${value##*[![:space:]]}"}"
}

host="$(trim "${DOCKER_HOST:-}")"
case "$host" in
  "")
    sock="$(trim "${DOCKER_SOCK:-}")"
    SOCK="${sock:-/var/run/docker.sock}"
    ;;
  unix://*) SOCK="${host#unix://}" ;;
  *) SOCK="" ;;
esac

if [ "$(id -u)" = "0" ]; then
  if [ -n "$SOCK" ] && [ -S "$SOCK" ]; then
    sock_gid="$(stat -c '%g' "$SOCK")"
    exec setpriv --reuid bun --regid bun --groups "$sock_gid" -- "$@"
  fi
  exec setpriv --reuid bun --regid bun --clear-groups -- "$@"
fi

exec "$@"
