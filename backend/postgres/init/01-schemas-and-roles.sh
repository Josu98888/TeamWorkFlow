#!/bin/sh
# Runs once, on the first start of an empty PostgreSQL data directory
# (docker-entrypoint-initdb.d). Creates one schema and one role per
# data-owning service inside $POSTGRES_DB. Each role owns only its schema
# and has no USAGE on the others, so cross-service reads fail with
# "permission denied" (see backend/STEPS.md S1.1).
#
# The entrypoint may source this file instead of executing it, so the body
# runs in a subshell: its shell options never leak into the entrypoint.
(
  set -eu

  SERVICES="auth organization attendance tasks notifications billing"

  for svc in $SERVICES; do
    var="$(echo "$svc" | tr '[:lower:]' '[:upper:]')_DB_PASSWORD"
    eval "pass=\${$var:-}"
    if [ -z "$pass" ]; then
      echo "init: missing $var" >&2
      exit 1
    fi

    # CREATEDB lets `prisma migrate dev` create its shadow database.
    psql -v ON_ERROR_STOP=1 \
      --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
      -v role="${svc}_svc" -v schema="$svc" -v pass="$pass" <<'SQL'
CREATE ROLE :"role" LOGIN CREATEDB PASSWORD :'pass';
CREATE SCHEMA :"schema" AUTHORIZATION :"role";
ALTER ROLE :"role" SET search_path = :"schema";
SQL
  done

  # No service may create objects in, or read from, the public schema.
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c 'REVOKE ALL ON SCHEMA public FROM PUBLIC;'
) || exit 1
