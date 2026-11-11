FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS release
# Apply Alpine security updates so the image doesn't ship known-fixed CVEs.
# setpriv (not su-exec) lets the entrypoint grant the socket's GID even when
# it has no /etc/group entry.
RUN apk upgrade --no-cache \
  && apk add --no-cache setpriv
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
