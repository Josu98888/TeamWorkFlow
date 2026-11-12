# Stage 1: Build & Development
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

RUN npm install -g pnpm@11.5.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# The pnpm store lives in a BuildKit cache, so a retried build reuses what was already downloaded
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY . .

RUN pnpm run prisma:attendance:generate
RUN pnpm run build

# Stage 2: Production
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

RUN npm install -g pnpm@11.5.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --store-dir /pnpm/store

COPY --from=builder /usr/src/app/src/prisma/generated ./src/prisma/generated
COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 3003

CMD ["node", "dist/main"]
