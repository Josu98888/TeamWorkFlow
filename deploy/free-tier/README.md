# Free-tier demo deploy

Zero-cost public demo: Vercel (frontend), Render (`core`), Koyeb (`telemetry`), Synadia Cloud (NATS), Supabase (PostgreSQL and task media). For a real VPS use [`../README.md`](../README.md), or [`../vps/README.md`](../vps/README.md) for one always-on VPS with the same Supabase setup. Plan and decisions: `odd/tasks/free-tier-deploy.md`.

```
browser -> Vercel (frontend)
             |- rewrite /api/v1/telemetry/* -> Koyeb (telemetry)
             |- rewrite /api/v1/*           -> Render (core)
browser -> Koyeb  /ws  (Socket.IO, direct; short-lived socket token)
core, telemetry -> Synadia (NATS, TLS + creds)     core, telemetry -> Supabase (Postgres pooler)
core -> Supabase Storage (S3 API);  browser -> Supabase Storage (presigned PUT/GET)
```

## 1. Overview, limits and caveats

| Piece | Platform | Plan |
|-------|----------|------|
| Frontend (Next.js) | Vercel | Hobby |
| `core` | Render, Docker web service | Free |
| `telemetry` | Koyeb, Docker service | Free |
| NATS + JetStream | Synadia Cloud | Free (Personal) |
| PostgreSQL | Supabase | Free |
| Task photos | Supabase Storage (S3-compatible) | Free |

Caveats (this is a demo, never for real users or real data):

- **Sleep.** Render free sleeps after ~15 min without traffic, Koyeb free after ~1 h; the first request then takes tens of seconds. An uptime pinger (section 9) mitigates it. While a service sleeps, its cron jobs (shift lifecycle in `core`, periodic alert check in `telemetry`) and its NATS consumers do not run.
- **Supabase** pauses a free project after about 1 week of inactivity (restore it from the dashboard).
- **Synadia free limits are not confirmed.** The app opens 8 NATS connections in total, creates 6 streams (one per module, `<MODULE>_EVENTS`) and 16 durable consumers. Check your account limits before deploying (section 4).
- **Outbox is in memory.** Events that fail to publish are lost on restart.
- **RAM.** Render free and Koyeb free give 512 MB each.
- Payments are `fake`, push notifications are off.
- Free-tier terms change; confirm the current limits on each platform's pricing page.

## 2. Order of operations

1. Supabase: project, roles script, bucket, S3 keys.
2. Synadia: account, user, `.creds`.
3. Render: `core` (deploy it **before** telemetry: telemetry sends a `purpose` field in `auth.token.verify` that an older core rejects with 422).
4. Koyeb: `telemetry`.
5. Vercel: frontend (needs the Render and Koyeb hosts).
6. Back-fill the URLs that need the final hosts: `APP_URL` (Render), `WEB_ORIGIN` (Koyeb), then redeploy both. `NEXT_PUBLIC_WS_URL` is already set in step 5.
7. Seed the platform admin.
8. Set up the uptime pinger.
9. Run the smoke test.

Chicken-and-egg: Render and Koyeb hosts are known after their first deploy, Vercel's after its first build. Deploy core and telemetry with placeholder `APP_URL`/`WEB_ORIGIN`, then fix them (step 6).

## 3. Supabase

### 3.1 Project

1. Create a project. Pick the region closest to Render/Koyeb. Save the database password.
2. In the project settings keep **Data API off** (the app never uses PostgREST) and enable **RLS** by default for new tables if offered. Module roles own their tables, so RLS does not affect the app; it only blocks `anon`/`authenticated`.
3. Note the **project ref** (Project Settings > General) and the region.
4. Connect dialog > **Session pooler** (port 5432). Host looks like `aws-0-<region>.pooler.supabase.com`. User is `<role>.<projectref>`. Use the session pooler, not the transaction pooler (6543): Prisma migrations take an advisory lock that needs a session.
5. Project Settings > Database > SSL Configuration: download the **CA certificate** (`.crt`, PEM). It becomes `DB_SSL_CA`.

### 3.2 Roles and schemas (once)

Supabase reserves the `auth` and `storage` schemas, so module schemas are prefixed: `tw_auth`, `tw_organization`, `tw_tasks`, `tw_notifications`, `tw_billing`, `tw_attendance`, with roles `tw_<module>_svc`. Generate 6 distinct passwords first (for example `openssl rand -hex 16`; hex needs no URL encoding).

**Option (a): psql** (run as `postgres` over the session pooler, from the repo root):

```bash
psql "postgresql://postgres.<projectref>:<postgres-password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require" \
  -v ON_ERROR_STOP=1 \
  -v auth_pass='...' -v organization_pass='...' -v tasks_pass='...' \
  -v notifications_pass='...' -v billing_pass='...' -v attendance_pass='...' \
  -f backend/postgres/supabase/01-schemas-and-roles.sql
```

No psql installed? Use a throwaway container (Windows: use Git Bash or PowerShell with `${PWD}`):

```bash
docker run --rm -v "$PWD/backend/postgres/supabase:/sql:ro" postgres:17-alpine \
  psql "postgresql://postgres.<projectref>:<postgres-password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require" \
  -v ON_ERROR_STOP=1 \
  -v auth_pass='...' -v organization_pass='...' -v tasks_pass='...' \
  -v notifications_pass='...' -v billing_pass='...' -v attendance_pass='...' \
  -f /sql/01-schemas-and-roles.sql
```

**Option (b): SQL Editor.** Copy `backend/postgres/supabase/01-schemas-and-roles.editor.sql`, replace the six `CHANGE_ME_*` placeholders, paste into the Supabase SQL Editor and run. Delete the saved snippet afterwards. **Never commit the edited copy.**

Both are idempotent (re-running resets the passwords). Both files do the same; keep them in sync.

### 3.3 Database URLs

Format, one per module (user is the role plus `.<projectref>`; URL-encode special characters in the password, hex needs none):

```
postgresql://tw_<module>_svc.<projectref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?schema=tw_<module>
```

| Variable | Service | Role / schema |
|----------|---------|---------------|
| `AUTH_DATABASE_URL` | core | `tw_auth_svc` / `tw_auth` |
| `ORGANIZATION_DATABASE_URL` | core | `tw_organization_svc` / `tw_organization` |
| `BILLING_DATABASE_URL` | core | `tw_billing_svc` / `tw_billing` |
| `TASKS_DATABASE_URL` | core | `tw_tasks_svc` / `tw_tasks` |
| `NOTIFICATIONS_DATABASE_URL` | core | `tw_notifications_svc` / `tw_notifications` |
| `ATTENDANCE_DATABASE_URL` | telemetry | `tw_attendance_svc` / `tw_attendance` |

Also set on both services:

| Variable | core | telemetry | Notes |
|----------|------|-----------|-------|
| `DB_SSL` | `true` | `true` | Use this, not `sslmode=` in the URL (pg gives the URL precedence) |
| `DB_SSL_CA` | PEM content | PEM content | Multi-line, or literal `\n` between lines. Without it the connection is encrypted but not verified |
| `DB_POOL_MAX` | `3` | `5` | Per Prisma client: core opens 5 clients (15 connections), telemetry 1 (5) |

Connection budget: the session pooler limits concurrent clients (the default pool size on the free tier is small, often 15; **not verified**). 15 + 5 plus migrations at start can exceed it. If you see `max clients reached`, lower `DB_POOL_MAX` (core `2`, telemetry `3`) or raise the pool size in Supabase > Database settings. `MIGRATE_<X>_DATABASE_URL` variables are optional (they default to the runtime URLs, which already use the session pooler).

### 3.4 Storage (task photos)

1. Storage > New bucket: name `teamworkflow-tasks` (or your own), **private**.
2. Storage > Settings > S3 Connection: copy the **endpoint** (`https://<projectref>.supabase.co/storage/v1/s3`) and the **region**; create **access keys** (access key ID + secret). Keys bypass RLS; keep them secret.
3. core variables:

| Variable | Value |
|----------|-------|
| `S3_ENDPOINT` | `https://<projectref>.supabase.co/storage/v1/s3` |
| `S3_REGION` | the region shown in the S3 settings (for example `us-east-1`) |
| `S3_BUCKET` | the bucket name |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | the access key pair (set both) |
| `S3_FORCE_PATH_STYLE` | `true` |

**CORS.** The browser uploads photos with a presigned `PUT` (and reads with `GET`) straight to Supabase Storage from the Vercel origin, so the S3 endpoint must answer CORS for that origin. Unknown: whether Supabase exposes per-bucket CORS configuration on the S3 endpoint (the AWS `PutBucketCors` call is, as far as we know, not supported; its Storage API may already answer with permissive CORS headers). Not verified. So: after deploy, test the task photo upload from the Vercel URL (browser dev tools > Network, look for a failed preflight/`CORS` error). If it fails, options: ask Supabase support/check the current Storage docs for CORS settings, or use another S3-compatible store with bucket CORS (Cloudflare R2, Backblaze B2) by changing only the `S3_*` variables, with CORS allowing `PUT`, `GET`, header `Content-Type` and origin `https://<vercel-host>`. The rest of the demo works without photos.

## 4. Synadia Cloud (NATS)

1. Create a Synadia Cloud account and a team/account (free plan). Check its limits for connections, streams, consumers and JetStream storage against section 1.
2. Create a **user** in that account and download its `.creds` file.
3. Both services use the same credentials:

| Variable | Value |
|----------|-------|
| `NATS_SERVER` | `tls://connect.ngs.global` |
| `NATS_CREDS` | full content of the `.creds` file (multi-line, or literal `\n` for each line break if the platform field is single-line) |

The `.creds` file is a secret: never commit it or paste it into chats or issues. It contains the user JWT and seed; rotate the user if it leaks.

## 5. Render: core

New > Web Service > connect the GitHub repo (deploy branch).

| Field | Value |
|-------|-------|
| Language / runtime | Docker |
| Root Directory | leave empty |
| Dockerfile Path | `./backend/core/Dockerfile.prod` (relative to the repo root) |
| Docker Build Context Directory | `./backend/core` |
| Instance type | Free |
| Health Check Path | `/api/v1/health` |

(Render semantics: the Dockerfile path is relative to the repo root unless a Root Directory is set, and the build context directory is a separate field. UI labels may differ slightly; **not verified**. If you set Root Directory to `backend/core`, use `Dockerfile.prod` and context `.`.) The default image target is the last stage (`runner`), so no target setting is needed.

Environment variables. `PORT` is **required** by core (joi) and is injected by Render (default 10000), so do not set it. Core listens on it.

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `MIGRATE_ON_START` | `true` (applies the 5 module migrations at start; a failure exits the container) |
| `JWT_SECRET` | `openssl rand -base64 48` (min 32 chars) |
| `APP_URL` | the Vercel URL, `https://<project>.vercel.app` (back-fill after Vercel) |
| `COOKIE_SECURE` | leave unset (default `true`; both Vercel and Render serve HTTPS) |
| `PAYMENT_PROVIDER` | `fake` |
| `FCM_ENABLED` | `false` |
| `NATS_SERVER`, `NATS_CREDS` | section 4 |
| `AUTH_DATABASE_URL`, `ORGANIZATION_DATABASE_URL`, `BILLING_DATABASE_URL`, `TASKS_DATABASE_URL`, `NOTIFICATIONS_DATABASE_URL` | section 3.3 |
| `DB_SSL`, `DB_SSL_CA`, `DB_POOL_MAX` | `true`, CA PEM, `3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | section 3.4 |

Optional with defaults: `ACCESS_TOKEN_TTL` (`15m`), `REFRESH_TOKEN_TTL` (`7d`), `MEDIA_URL_TTL_SECONDS` (`300`), `BILLING_TZ`, `VAT_PERCENT`, `TRIAL_DAYS`, `DUE_DAYS`, `GRACE_DAYS`, `DATA_RETENTION_DAYS`. `MP_*` only with `PAYMENT_PROVIDER=mercadopago`.

Core has no CORS and no `WEB_ORIGIN`: the browser reaches it through the Vercel rewrite.

Check: `https://<core>.onrender.com/api/v1/health` returns `{"status":"ok"}`.

## 6. Koyeb: telemetry

Create Service > GitHub > the repo, builder **Dockerfile**.

| Field | Value |
|-------|-------|
| Work directory | `backend/telemetry` (the build context) |
| Dockerfile location | `backend/telemetry/Dockerfile` (or `Dockerfile` relative to the work directory; the default final stage `runner` is built) |
| Instance | Free |
| Exposed port | `3003`, protocol HTTP |
| Health check | HTTP, path `/api/v1/telemetry/health`, port 3003 |

Field names and whether the Dockerfile path is relative to the work directory are **not verified**; pick the combination that makes `COPY package.json ...` resolve inside `backend/telemetry`. The Dockerfile uses BuildKit cache mounts (`RUN --mount=type=cache`); if Koyeb's builder rejects them, report it (it would need a Dockerfile change).

| Variable | Value |
|----------|-------|
| `PORT` | `3003` (set it explicitly to match the exposed port; the default is also 3003) |
| `NODE_ENV` | `production` |
| `MIGRATE_ON_START` | `true` |
| `ATTENDANCE_DATABASE_URL` | section 3.3 |
| `DB_SSL`, `DB_SSL_CA`, `DB_POOL_MAX` | `true`, CA PEM, `5` |
| `NATS_SERVER`, `NATS_CREDS` | section 4 |
| `WEB_ORIGIN` | exact Vercel origin, `https://<project>.vercel.app`, no trailing slash and no path (back-fill after Vercel) |

Do **not** set `JWT_SECRET` on telemetry: it enables a local-verification fallback for HTTP when core is unreachable; without it telemetry always verifies tokens through core, so a core outage fails closed and no signing secret is stored on a second host.

Optional: `NATS_TIMEOUT_MS` (`5000`; raise to about `15000` while core wakes from sleep), `AUTH_CACHE_TTL_MS`, `RATE_LIMIT_AUTH_*`.

Check: `https://<app>.koyeb.app/api/v1/telemetry/health` returns `{"status":"ok"}`.

## 7. Vercel: frontend

Import the repo: Root Directory `frontend`, Framework Preset Next.js (build `pnpm build`). Environment variables (apply to Production, **build time**):

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_USE_MOCKS` | `false` (mocks are on unless exactly `false`) |
| `CORE_URL` | `https://<core>.onrender.com` |
| `TELEMETRY_URL` | `https://<app>.koyeb.app` |
| `NEXT_PUBLIC_WS_URL` | `https://<app>.koyeb.app` (the Tower socket goes straight to telemetry; rewrites cannot proxy WebSocket) |

All four are baked at build time: **redeploy after changing any of them**. The browser calls relative `/api/v1/...` on the Vercel origin, which rewrites to Render/Koyeb, so the auth cookies stay first-party (`SameSite=Lax`, `HttpOnly`). The Vercel rewrite adds latency and a cold core may take 30+ s on the first request.

## 8. Back-fill URLs and seed the platform admin

1. Set `APP_URL` (Render) and `WEB_ORIGIN` (Koyeb) to the final Vercel origin; both services redeploy.
2. Seed the platform admin (once). It runs locally against Supabase; it is not part of the images (the runner has no dev dependencies). From `backend/core`:

```bash
pnpm install
pnpm prisma:auth:generate          # generates the Prisma client used by the seed
export AUTH_DATABASE_URL='postgresql://tw_auth_svc.<projectref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?schema=tw_auth'
export DB_SSL=true                  # and DB_SSL_CA=<PEM> to verify the certificate
pnpm seed:platform-admin
```

The seed compiles the project, then asks for the admin email and password in the terminal (a TTY is required; there are no variables for them). Only `AUTH_DATABASE_URL`, `DB_SSL`, `DB_SSL_CA` and `DB_POOL_MAX` are read. A `backend/core/.env` also works (loaded with dotenv); do not commit it. `prisma:auth:generate` may need `AUTH_DATABASE_URL` set too.

Run it after core has started once (migrations create the tables). Platform admin tenant routes are blocked by design; the admin only uses `/billing/admin/*`.

## 9. Uptime pinger

Use a free monitor (UptimeRobot, cron-job.org) to hit both health URLs every 5 to 10 minutes:

- `https://<core>.onrender.com/api/v1/health`
- `https://<app>.koyeb.app/api/v1/telemetry/health`

This keeps both awake (and their cron jobs and NATS consumers running). Health routes are shallow (no DB/NATS call), so they cost nothing. Render free has a monthly instance-hours allowance (about 750 h, enough for one always-on service); check the fair-use terms of each platform before pinging 24/7. If you ping only during demo hours, expect a cold start on the first visit.

## 10. Smoke test

- [ ] Both health URLs return `{"status":"ok"}`.
- [ ] Render and Koyeb logs show `migrations applied` and no NATS or DB errors.
- [ ] Open the Vercel URL, register an account (new tenant) and log in; reload keeps the session.
- [ ] Create a site and a shift (core screens).
- [ ] Clock in (telemetry route through the rewrite) succeeds.
- [ ] Tower page (needs the `tower` feature of the plan): the socket connects (Network > WS `/ws` on the Koyeb host) and a new clock-in updates the site live.
- [ ] Task photo upload works (section 3.4 CORS).
- [ ] Platform admin can log in.

## 11. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Container exits at start, deploy fails | Migration failed. Read the logs for `[entrypoint] migrating <module>`: wrong URL or password, user not `<role>.<projectref>`, roles script not run, pooler unreachable, missing `DB_SSL`. Fix and redeploy |
| `max clients reached` / connection errors | Supabase pooler limit. Lower `DB_POOL_MAX` (core 2, telemetry 3) or raise the pool size |
| Telemetry routes answer 422 | Core is older than telemetry (`purpose` field rejected). Redeploy core first |
| Telemetry routes answer 503/504 | Core asleep or unreachable over NATS. Wait and retry, raise `NATS_TIMEOUT_MS`, use the pinger |
| Tower socket fails to connect | `WEB_ORIGIN` not the exact Vercel origin (scheme, host, no trailing slash); `NEXT_PUBLIC_WS_URL` wrong or not rebuilt; `socket-token` 403 because the plan lacks `tower` |
| Login works but session is lost | `COOKIE_SECURE=false` was set, or the browser calls Render directly instead of `/api/v1` on the Vercel origin (`CORE_URL`/`TELEMETRY_URL` wrong or not rebuilt) |
| Frontend still shows mock data | `NEXT_PUBLIC_USE_MOCKS` is not exactly `false`; redeploy |
| App fails to start: `Config validation error: invalid or missing X` | Only the variable name is reported. Check `X` (for `NATS_CREDS` the value must contain the `BEGIN NATS USER JWT` block; for `DB_SSL_CA` the `BEGIN CERTIFICATE` block and `DB_SSL=true`) |
| NATS auth or limit errors | Wrong creds/user, or Synadia free limits (connections, streams, consumers) exceeded; check the account |
| Photo upload fails in the browser | S3 CORS (section 3.4) or wrong `S3_*` values; presigned URL host must be the Supabase endpoint |
| Slow first request | Cold start of Render/Koyeb (sleep); use the pinger |
| Supabase unreachable after a quiet week | Project paused; restore it in the dashboard |
