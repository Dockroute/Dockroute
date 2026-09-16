FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS release
# Apply Debian security updates so the image doesn't ship known-fixed CVEs
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*
COPY --from=install /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.sh

# No USER: the entrypoint grants the app user the Docker socket's group
# (whatever GID the host uses) and drops to it before exec'ing the app.
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]

# Confirms the reconcile loop is actually progressing (Docker socket
# reachable, provider sync succeeding), not just that the process is alive.
# start-period covers the initial container list + first sync.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["bun", "run", "src/healthcheck.ts"]
