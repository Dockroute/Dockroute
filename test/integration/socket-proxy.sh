#!/bin/sh
# End-to-end check of the README "Hardened setup: socket proxy" example against
# a real Docker engine. The compose file is extracted from README.md, so the
# documented example cannot drift without this check failing.
#
# Requires the image under test tagged as dockroute:ci.
set -eu

cd "$(dirname "$0")/../.."

PROJECT=dockroute-it
PROXY_NET="${PROJECT}_docker-proxy"
PROXY=http://socket-proxy:2375
TARGET="${PROJECT}-target"
RECORD="[log]   it.example.com 300 IN A 192.0.2.10"

work="$(mktemp -d)"
failed=1

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "ok: $*"
}

compose() {
  docker compose -p "$PROJECT" -f "$work/compose.yml" -f test/integration/compose.ci.yml "$@"
}

cleanup() {
  if [ "$failed" = 1 ]; then
    compose logs --no-color || true
  fi
  docker rm -f "$TARGET" >/dev/null 2>&1 || true
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# HTTP status of METHOD URL, sent from the dockroute container (the only
# client the proxy allows). Exits once the headers arrive, so streaming
# endpoints such as /events do not hang.
status_from_dockroute() {
  compose exec -T -e METHOD="$1" -e URL="$2" dockroute \
    bun -e 'const r = await fetch(process.env.URL, { method: process.env.METHOD }); console.log(r.status); process.exit(0)'
}

expect_status() {
  expected="$1"
  actual="$2"
  what="$3"
  [ "$actual" = "$expected" ] || fail "$what: expected HTTP $expected, got $actual"
  pass "$what -> $actual"
}

awk '/^### Hardened setup: socket proxy/ { section = 1 }
     section && /^```yaml/ { inside = 1; next }
     inside && /^```/ { exit }
     inside' README.md >"$work/compose.yml"
grep -q 'socket-proxy:' "$work/compose.yml" || fail "socket-proxy compose example not found in README.md"

DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
export DOCKER_GID

compose up -d

docker run -d --name "$TARGET" \
  --label dockroute.enabled=true \
  --label dockroute.hostname=it.example.com \
  --label dockroute.target=192.0.2.10 \
  busybox:1.37 sleep 300 >/dev/null
target_id="$(docker inspect -f '{{.Id}}' "$TARGET")"

# 1. DockRoute discovers the labelled container through the proxy.
i=0
until compose logs --no-color dockroute | grep -qF "$RECORD"; do
  i=$((i + 1))
  [ "$i" -le 60 ] || fail "DockRoute did not plan the record within 60s"
  sleep 1
done
pass "record planned through the proxy"
compose logs --no-color dockroute | grep -qF "docker=tcp://socket-proxy:2375" ||
  fail "DockRoute is not using DOCKER_HOST=tcp://socket-proxy:2375"
pass "DockRoute uses the proxy endpoint"

# 2. The app process has no socket and no Docker group.
compose exec -T dockroute test ! -e /var/run/docker.sock || fail "a Docker socket is mounted in dockroute"
pass "no Docker socket in dockroute"
status="$(compose exec -T dockroute cat /proc/1/status)"
uid="$(echo "$status" | awk '/^Uid:/ { print $2 }')"
groups="$(echo "$status" | awk '/^Groups:/ { $1 = ""; print }')"
[ "$uid" != 0 ] || fail "the app runs as root"
pass "app runs as uid $uid"
for g in $groups; do
  [ "$g" != "$DOCKER_GID" ] || fail "the app has the Docker group ($DOCKER_GID): groups=$groups"
done
pass "app supplementary groups [${groups# }] exclude the Docker group ($DOCKER_GID)"

# 3. The proxy only allows the three read endpoints DockRoute uses.
expect_status 200 "$(status_from_dockroute GET "$PROXY/_ping")" "GET /_ping"
expect_status 200 "$(status_from_dockroute GET "$PROXY/v1.43/containers/json")" "GET /v1.43/containers/json"
expect_status 200 "$(status_from_dockroute GET "$PROXY/v1.43/events")" "GET /v1.43/events"
expect_status 403 "$(status_from_dockroute GET "$PROXY/containers/$target_id/json")" "GET /containers/{id}/json"
expect_status 403 "$(status_from_dockroute GET "$PROXY/images/json")" "GET /images/json"
expect_status 405 "$(status_from_dockroute POST "$PROXY/containers/$target_id/stop")" "POST /containers/{id}/stop"
[ "$(docker inspect -f '{{.State.Running}}' "$TARGET")" = true ] || fail "the target container was stopped"
pass "target container still running"

# 4. Any other client on the proxy network is rejected (-allowfrom=dockroute).
other="$(docker run --rm --network "$PROXY_NET" --entrypoint bun dockroute:ci \
  -e 'const r = await fetch("http://socket-proxy:2375/_ping"); console.log(r.status)')"
expect_status 403 "$other" "GET /_ping from another container"

failed=0
echo "socket-proxy integration: all checks passed"
