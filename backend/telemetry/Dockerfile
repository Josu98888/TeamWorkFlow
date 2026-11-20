# Stage 1: Build & Development
FROM node:24-alpine AS builder

WORKDIR /usr/src/app

RUN npm install -g pnpm@11.5.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# The pnpm store lives in a BuildKit cache, so a retried build reuses what was already downloaded
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY . .

RUN pnpm run prisma:attendance:generate
RUN pnpm run build

# Stage 2: Migrations (one-shot). The runner has no prisma CLI (dev dependency), so this target reuses the
# builder: prisma CLI, prisma.attendance.config.ts and src/prisma/migrations. Needs ATTENDANCE_DATABASE_URL.
#   docker build --target migrate -t teamworkflow-telemetry-migrate .
FROM builder AS migrate

ENV NODE_ENV=production

USER node

CMD ["pnpm", "run", "prisma:attendance:migrate:deploy"]

# Stage 3: Migration CLI for the runtime image: the prisma CLI (7.10.0, same as package.json) and dotenv (imported by the
# prisma.*.config.ts files) in an isolated /opt/migrate, so the runner keeps its prod-only node_modules.
# Used by docker-entrypoint.sh when MIGRATE_ON_START=true (hosts without a pre-deploy step, e.g. Render free).
FROM node:24-alpine AS migrator-cli

RUN mkdir -p /opt/migrate && chown node:node /opt/migrate

USER node
ENV HOME=/home/node
WORKDIR /opt/migrate

RUN npm install --no-audit --no-fund prisma@7.10.0 dotenv@18.0.9 && npm cache clean --force

# Stage 4: Production (default target: keep it the last stage). With MIGRATE_ON_START=true the entrypoint
# applies the attendance migrations before starting (see docker-entrypoint.sh).
FROM node:24-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

RUN npm install -g pnpm@11.5.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --store-dir /pnpm/store

COPY --from=builder /usr/src/app/src/prisma/generated ./src/prisma/generated
COPY --from=builder /usr/src/app/dist ./dist

# Migrations at start (opt-in). Schema and migrations come straight from the build context.
COPY --from=migrator-cli --chown=node:node /opt/migrate /opt/migrate
COPY --chown=node:node prisma.attendance.config.ts /opt/migrate/
COPY --chown=node:node src/prisma/schema.prisma /opt/migrate/src/prisma/schema.prisma
COPY --chown=node:node src/prisma/migrations /opt/migrate/src/prisma/migrations

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

USER node
ENV HOME=/home/node

EXPOSE 3003

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"]
