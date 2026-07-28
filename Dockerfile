FROM oven/bun:1 AS base
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

USER bun
ENTRYPOINT ["bun", "run", "src/index.ts"]
