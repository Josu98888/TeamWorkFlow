#!/bin/sh
# Runtime entrypoint. With MIGRATE_ON_START=true it applies the attendance migrations first (for hosts
# without a pre-deploy step, e.g. Koyeb); otherwise it only starts the app. A failed migration exits
# non-zero before the app starts, so the platform marks the deploy as failed instead of serving a stale schema.
# `prisma migrate deploy` takes an advisory lock, so concurrent instances are safe.
set -eu

if [ "${MIGRATE_ON_START:-false}" = "true" ]; then
  # Subshell: the app below keeps /usr/src/app as its working directory.
  (
    cd /opt/migrate
    echo "[entrypoint] migrating attendance"
    ./node_modules/.bin/prisma migrate deploy --config prisma.attendance.config.ts
  )
  echo "[entrypoint] migrations applied"
fi

# exec: node becomes PID 1 and receives SIGTERM/SIGINT directly.
exec "$@"
