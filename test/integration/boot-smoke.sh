#!/bin/sh
# Boot smoke test of a built image: the app must reach its startup lines within
# BOOT_TIMEOUT seconds, run as the unprivileged bun user holding the Docker
# socket's group, turn healthy, and the entrypoint's CPU preflight must refuse
# a CPU without x86-64-v2 instead of letting Bun hang. Any boot that hangs or
# exits silently fails here, whatever the cause.
#
# Usage: test/integration/boot-smoke.sh [image]   (default: dockroute:ci)
set -eu

cd "$(dirname "$0")/../.."

IMAGE="${1:-dockroute:ci}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-30}"
NAME=dockroute-boot-smoke
PREFLIGHT_NAME=dockroute-boot-smoke-preflight
STARTED="dockroute starting (provider=log"

failed=1

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "ok: $*"
}

cleanup() {
  if [ "$failed" = 1 ]; then
    docker logs "$NAME" 2>&1 || true
  fi
  # A hung PID 1 ignores the SIGTERM from `timeout`, so remove both by name.
  docker rm -f "$NAME" "$PREFLIGHT_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 1. The app boots: banner and startup line within BOOT_TIMEOUT.
docker run -d --name "$NAME" \
  --health-interval=2s --health-start-period=0s \
  -e DOCKROUTE_PROVIDER=log \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  "$IMAGE" >/dev/null
i=0
until docker logs "$NAME" 2>&1 | grep -qF "$STARTED"; do
  [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] ||
    fail "the container exited before printing its startup line"
  i=$((i + 1))
  [ "$i" -le "$BOOT_TIMEOUT" ] || fail "no startup line within ${BOOT_TIMEOUT}s: the boot is stuck"
  sleep 1
done
docker logs "$NAME" 2>&1 | grep -qF "DockRoute v" || fail "the startup banner is missing"
pass "booted to the startup line in under ${i}s"

# 2. The entrypoint dropped root: PID 1 (the app) runs as bun and holds the
# socket's group, whatever GID the host gives it.
sock_gid="$(stat -c '%g' /var/run/docker.sock)"
proc_status="$(docker exec "$NAME" cat /proc/1/status)"
echo "$proc_status" | grep -Eq '^Uid:[[:space:]]+1000[[:space:]]+1000[[:space:]]+1000[[:space:]]+1000$' ||
  fail "the app does not run as bun: $(echo "$proc_status" | grep '^Uid:')"
echo "$proc_status" | grep -Eq "^Groups:.*(^|[[:space:]])$sock_gid([[:space:]]|$)" ||
  fail "the app lacks the socket group $sock_gid: $(echo "$proc_status" | grep '^Groups:')"
pass "the app runs as bun with the socket group $sock_gid"

# 3. The image's HEALTHCHECK turns healthy (interval shortened above).
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ]; do
  i=$((i + 1))
  [ "$i" -le "$BOOT_TIMEOUT" ] || fail "not healthy within ${BOOT_TIMEOUT}s"
  sleep 1
done
pass "healthcheck healthy"
docker rm -f "$NAME" >/dev/null

# 4. The CPU preflight refuses a QEMU kvm64 CPU, naming every missing flag.
output="$(timeout 20 docker run --rm --name "$PREFLIGHT_NAME" \
  -e DOCKROUTE_CPUINFO=/cpuinfo \
  -v "$PWD/test/fixtures/cpuinfo/qemu-kvm64.txt:/cpuinfo:ro" \
  "$IMAGE" 2>&1)" && fail "the container started on a CPU without x86-64-v2"
status=$?
[ "$status" != 124 ] || fail "the preflight did not stop the container within 20s"
echo "$output" | grep -qF 'missing ssse3 sse4_1 sse4_2 popcnt.' || fail "unexpected preflight output: $output"
echo "$output" | grep -qF 'CPU type to "host"' || fail "unexpected preflight output: $output"
pass "preflight refuses a kvm64 CPU (exit $status)"

failed=0
echo "boot smoke: all checks passed"
