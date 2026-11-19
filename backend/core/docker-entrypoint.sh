#!/bin/sh
# Runtime entrypoint. With MIGRATE_ON_START=true it applies the five module migrations first (for hosts
# without a pre-deploy step, e.g. Render free); otherwise it only starts the app. A failed migration exits
# non-zero before the app starts, so the platform marks the deploy as failed instead of serving a stale schema.
# Concurrent instances are safe: `prisma migrate deploy` takes an advisory lock.
set -eu

if [ "${MIGRATE_ON_START:-false}" = "true" ]; then
  # Subshell: the app below keeps /usr/src/app as its working directory.
  (
    cd /opt/migrate
    for module in auth organization billing tasks notifications; do
      echo "[entrypoint] migrating ${module}"
      ./node_modules/.bin/prisma migrate deploy --config "prisma.${module}.config.ts"
    done
  )
  echo "[entrypoint] migrations applied"
fi

# exec: node becomes PID 1 and receives SIGTERM/SIGINT directly.
exec "$@"
