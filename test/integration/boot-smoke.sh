#!/bin/sh
# Boot smoke test of a built image: the app must reach its startup lines within
# BOOT_TIMEOUT seconds, and the entrypoint's CPU preflight must refuse a CPU
# without SSE4.2/POPCNT instead of letting Bun hang. Any boot that hangs or
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
docker rm -f "$NAME" >/dev/null

# 2. The CPU preflight refuses a QEMU kvm64 CPU with a clear message.
output="$(timeout 20 docker run --rm --name "$PREFLIGHT_NAME" \
  -e DOCKROUTE_CPUINFO=/cpuinfo \
  -v "$PWD/test/fixtures/cpuinfo/qemu-kvm64.txt:/cpuinfo:ro" \
  "$IMAGE" 2>&1)" && fail "the container started on a CPU without SSE4.2/POPCNT"
status=$?
[ "$status" != 124 ] || fail "the preflight did not stop the container within 20s"
echo "$output" | grep -qF 'CPU type to "host"' || fail "unexpected preflight output: $output"
pass "preflight refuses a kvm64 CPU (exit $status)"

failed=0
echo "boot smoke: all checks passed"
