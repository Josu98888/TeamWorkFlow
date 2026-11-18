# Deploy (single EC2 host)

One EC2 `t3.small` runs `nats`, `core`, `telemetry`, `frontend` and `nginx` with Docker Compose. PostgreSQL is RDS, task media is S3, images come from GHCR. Plan: `odd/tasks/ci-cd.md`. For a zero-cost demo on Vercel, Render, Koyeb, Synadia and Supabase see [`free-tier/README.md`](free-tier/README.md). For one 2 GB VPS (for example HostGator in São Paulo) with Supabase instead of RDS and S3 see [`vps/README.md`](vps/README.md).

```
internet :80 (:443 later) -> nginx -+-> /api/v1/telemetry/*  -> telemetry:3003
                                    +-> /ws                  -> telemetry:3003 (Socket.IO)
                                    +-> /api/v1/*            -> core:3000
                                    +-> /                    -> frontend:3000
nats:4222 (internal) <- core, telemetry      RDS / S3 <- core, telemetry
```

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | The stack. Profiles: `tls` (certbot), `local-db` (throwaway PostgreSQL) |
| `docker-compose.tls.yml` | Override that publishes 443 and swaps in the HTTPS server block |
| `nginx/` | `nginx.conf`, `conf.d/http.conf` (port 80), `snippets/locations.conf` (routing), `tls/https.conf` (not enabled by default) |
| `compose.env.example` | Copy to `deploy/.env`: `GHCR_OWNER`, `IMAGE_TAG`, local-db passwords |
| `env/core.env.example`, `env/telemetry.env.example` | Copy to `env/core.env`, `env/telemetry.env` (git-ignored) |

Only `nginx` publishes ports. The frontend has no runtime env: `NEXT_PUBLIC_*` and `BACKEND_URL` are baked at image build (see "Notes for the image build").

## Prerequisites

- Docker Engine with Compose v2.24 or newer, on the EC2 host. Add a 1 GB swap file: 2 GB of RAM is tight (memory limits below total about 1.3 GB).
- Security group: inbound 80 (and 443 later) from the internet, 22 from your IP only. RDS accepts 5432 only from the EC2 security group.
- EC2 instance role with S3 access to the bucket (`s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `bucket/*`, `s3:ListBucket` on the bucket). The IAM role and the bucket CORS (`PUT` and `GET` from the web origin, `Content-Type` allowed) are set up in the AWS guide (T6).
- `docker login ghcr.io` with a token that can read the packages (needed unless the packages are public).

## First-time setup

```bash
cd deploy
cp compose.env.example .env                       # set GHCR_OWNER (lowercase) and IMAGE_TAG
cp env/core.env.example env/core.env              # fill every CHANGE_ME
cp env/telemetry.env.example env/telemetry.env
```

Env vars that must be set (everything else has a default):

| Service | Required |
|---------|----------|
| core (and core-migrate) | `PORT`, `NATS_SERVER`, the five `*_DATABASE_URL`, `JWT_SECRET` (32+ chars); `APP_URL` and the `S3_*` values for a working app; `FCM_*` only when `FCM_ENABLED=true`; `MP_*` only when `PAYMENT_PROVIDER=mercadopago` |
| telemetry (and telemetry-migrate) | `ATTENDANCE_DATABASE_URL`; `NATS_SERVER`; `WEB_ORIGIN` must be the exact browser origin |

### Initialize RDS (once)

The database `teamworkflow` must exist (set it as the initial database name when creating the instance). `backend/postgres/init/01-schemas-and-roles.sh` creates one schema and one login role per module (`auth`, `organization`, `tasks`, `notifications`, `billing`, `attendance`) and revokes `public`. Run it once from the EC2 host with a throwaway container (the script reads the six `<OWNER>_DB_PASSWORD` variables):

```bash
cd <repo root>
docker run --rm -v "$PWD/backend/postgres/init:/init:ro" \
  -e PGHOST=<rds-endpoint> -e PGSSLMODE=require -e PGPASSWORD='<master password>' \
  -e POSTGRES_USER=<master user> -e POSTGRES_DB=teamworkflow \
  -e AUTH_DB_PASSWORD=... -e ORGANIZATION_DB_PASSWORD=... -e ATTENDANCE_DB_PASSWORD=... \
  -e TASKS_DB_PASSWORD=... -e NOTIFICATIONS_DB_PASSWORD=... -e BILLING_DB_PASSWORD=... \
  postgres:17-alpine sh /init/01-schemas-and-roles.sh
```

Use the same passwords in the `*_DATABASE_URL` values. Running it twice fails (`role already exists`). If `CREATE SCHEMA ... AUTHORIZATION` is refused on RDS, run `GRANT <module>_svc TO <master user>;` for each role and retry on a fresh database.

## Run

```bash
cd deploy
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

(`docker compose` with no `-f` also works when the folder has no other compose file.) Open `http://<ec2-public-ip>/`.

**Migrations gate startup.** `core-migrate` runs the five `prisma migrate deploy` scripts and `telemetry-migrate` runs the attendance one, each as a one-shot container (`restart: "no"`). `core` and `telemetry` use `depends_on: condition: service_completed_successfully`, so a failed migration leaves them in `created` state and `up -d` exits with an error. Read why with `docker compose -f docker-compose.prod.yml logs core-migrate telemetry-migrate`, fix, and run `up -d` again. `migrate deploy` is idempotent: every `up -d` re-checks it.

**Logs.** `docker compose -f docker-compose.prod.yml logs -f --tail=100 core telemetry nginx` (json-file, 10 MB x 3 files per service).

**Update.** Set `IMAGE_TAG` in `.env` (or leave `latest`), then `pull` and `up -d`: changed images are recreated, migrations run first. Roll back by setting the previous tag. Prune with `docker image prune -f`.

**Memory limits.** nats 128 MB, core 512 MB, telemetry 384 MB, frontend 256 MB, nginx 64 MB, certbot 128 MB; one-shot migrations 512 MB each (they run before the apps). Node heap caps are set through `NODE_OPTIONS`.

## HTTP versus HTTPS (read before the first login)

- The HTTP phase is for infrastructure testing only, never for real users: credentials and cookies travel in clear text.
- core sets the auth cookies `Secure` by default (`COOKIE_SECURE`, default `true`, independent of `NODE_ENV`). Browsers drop `Secure` cookies on plain `http://` (except localhost), so over an IP address login never sticks. `core.env.example` therefore ships `COOKIE_SECURE=false` for the HTTP phase, with `NODE_ENV=production` always; core logs a startup warning while that combination is active. Remove it (or set `true`) as soon as TLS is on.
- Cookies are `SameSite=Lax`, `HttpOnly`; the CSRF cookie is readable by the page. All of this works on a single origin, which nginx provides.
- core has no CORS (same origin). telemetry allows only `WEB_ORIGIN` (CORS and Socket.IO): set it to `http://<host>` now and `https://<domain>` after TLS, or the WebSocket handshake is refused.
- `APP_URL` (core) must be the public origin too; Mercado Pago webhooks need a public HTTPS URL.
- Do not use real customer data over plain HTTP: passwords and cookies travel unencrypted.

## Enable TLS (once a domain exists)

1. Create a DNS `A` record from the domain to the EC2 public IP (use an Elastic IP) and open port 443 in the security group.
2. Issue the certificate with the HTTP server still running (the webroot is served by nginx):
   ```bash
   docker compose -f docker-compose.prod.yml --profile tls run --rm --entrypoint certbot certbot \
     certonly --webroot -w /var/www/certbot --cert-name teamworkflow \
     -d <domain> --email <you@example.com> --agree-tos --no-eff-email
   ```
   `--cert-name teamworkflow` keeps the certificate path fixed (`/etc/letsencrypt/live/teamworkflow/`), so `nginx/tls/https.conf` needs no edit. While testing, add `--staging`; delete the staging lineage before the real issue.
3. In `.env` set `COMPOSE_FILE=docker-compose.prod.yml:docker-compose.tls.yml` and `COMPOSE_PROFILES=tls`.
4. In `env/core.env` remove `COOKIE_SECURE=false` (or set `COOKIE_SECURE=true`) and set `APP_URL=https://<domain>`; in `env/telemetry.env` set `WEB_ORIGIN=https://<domain>`.
5. `docker compose up -d`. nginx now redirects HTTP to HTTPS and serves 443; the `certbot` service renews twice a day when due, and nginx reloads every 6 hours to pick the new certificate up.
6. Rebuild the frontend image only if you pinned `NEXT_PUBLIC_WS_URL` to a host; the default (empty, same origin) needs nothing.

## Try it on one machine (`local-db`)

Throwaway PostgreSQL with the same init script, no RDS and no TLS. Images must exist in GHCR (or be tagged locally as `ghcr.io/<owner>/teamworkflow-<app>:<tag>`).

```bash
cd deploy
# env/core.env and env/telemetry.env: *_DATABASE_URL host `postgres`, no sslmode, passwords as in .env
docker compose -f docker-compose.prod.yml --profile local-db up -d
```

The `postgres` container is not published to the host. The init script runs only on an empty volume (`docker compose ... down -v` resets it). S3 is not emulated here: media uploads fail until a bucket and credentials are configured.

## Notes for the image build (T5)

- Push both runtime images and both migrate targets: `teamworkflow-core`, `teamworkflow-core-migrate`, `teamworkflow-telemetry`, `teamworkflow-telemetry-migrate`, `teamworkflow-frontend`, all lowercase under `ghcr.io/<owner>/`.
- `BACKEND_URL` only feeds the `/api/v1` rewrite in `frontend/next.config.ts` and is baked at build time. nginx sends `/api/v1` to core and never to the frontend, so the value is a fallback: build with `--build-arg BACKEND_URL=http://nginx` (internal service name) so a direct hit on the frontend container still reaches the API. Leave `NEXT_PUBLIC_USE_MOCKS=false` and `NEXT_PUBLIC_WS_URL` empty.
