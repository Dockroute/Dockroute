#!/bin/sh
# Zero-config Docker socket access: when the container starts as root, grant
# the app user the group that owns the mounted Docker socket, then drop
# privileges before exec'ing the app. The socket's group is only handed out
# when DOCKER_HOST is unset or unix://…; tcp:// (socket proxy mode) or any
# other value fails closed and the app never gets it. Values are trimmed the
# same way the app trims them. Started as any other user (compose `user:`
# override), the script is a no-op passthrough.
set -eu

# Bun needs x86-64-v2 (SSSE3, SSE4.1, SSE4.2, POPCNT). A VM CPU model that
# hides them, such as QEMU's kvm64/qemu64, makes Bun spin at 100% CPU without
# logging anything (or crash with SIGILL on genuinely old CPUs), so refuse to
# start with a clear message instead. Only x86 cpuinfo has a "flags" line: other architectures and
# an unreadable cpuinfo skip the check. DOCKROUTE_CPUINFO is a test hook.
cpu_flags="$(sed -n 's/^flags[[:space:]]*:\(.*\)$/\1/p' "${DOCKROUTE_CPUINFO:-/proc/cpuinfo}" 2>/dev/null | head -n 1)" || cpu_flags=""
if [ -n "$cpu_flags" ]; then
  missing=""
  for flag in ssse3 sse4_1 sse4_2 popcnt; do
    case " $cpu_flags " in
      *" $flag "*) ;;
      *) missing="$missing $flag" ;;
    esac
  done
  if [ -n "$missing" ]; then
    echo "dockroute: unsupported CPU, missing$missing. The Bun runtime needs x86-64-v2 (SSSE3, SSE4.1, SSE4.2 and POPCNT) and hangs without them. In a VM, set the CPU type to \"host\" (or x86-64-v2 or newer) and restart it." >&2
    exit 1
  fi
fi

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
