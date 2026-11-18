# DonWeb VPS deploy

One DonWeb Cloud Server runs the production stack of [`../README.md`](../README.md) (nginx, NATS, `core`, `telemetry`, `frontend`) with Docker Compose. PostgreSQL and task photos live on Supabase, images come from GHCR. Always on, one origin, no cold starts. Plan and decisions: `odd/tasks/donweb-deploy.md`. This guide only covers what is specific to this host; the generic runbook (run, TLS, logs) stays in [`../README.md`](../README.md).

```
internet :80/:443 -> nginx -+-> /api/v1/telemetry/*  -> telemetry:3003
                            +-> /ws                  -> telemetry:3003 (Socket.IO)
                            +-> /api/v1/*            -> core:3000
                            +-> /                    -> frontend:3000
nats:4222 (internal) <- core, telemetry
core, telemetry -> Supabase (Postgres session pooler)
core -> Supabase Storage (S3 API);  browser -> Supabase Storage (presigned PUT/GET)
```

## 1. Overview, memory budget and caveats

Target: DonWeb Cloud Server with 2 vCPU, 2 GB RAM, 20 GB NVMe, 1 TB transfer. Ubuntu 24.04 LTS is assumed (confirm the image DonWeb offers; the commands below are for Debian-family systems).

| Service | Memory limit (`mem_limit`) |
|---------|----------------------------|
| core | 512 MB |
| telemetry | 384 MB |
| frontend | 256 MB |
| nats | 128 MB |
| nginx | 64 MB |
| **Always on** | **about 1.34 GB** |
| certbot | 128 MB, only while it renews (profile `tls`) |
| `core-migrate`, `telemetry-migrate` | 512 MB each, one-shot, run before the apps |

Why 2 GB: the limits above plus the OS and Docker leave little headroom, so 1 GB does not fit. More than 2 GB is only needed if PostgreSQL or an object store ran on the host, which this setup avoids. Add the swap file of section 3.4 anyway.

Caveats and open checks:

- Images are never built on the VPS (`next build` and `nest build` do not fit in 2 GB). They are pulled from GHCR (section 6).
- 20 GB of disk: old images pile up, prune them (section 12).
- The Supabase pooler connection budget and Storage CORS are the same open checks as in the free-tier guide ([3.3](../free-tier/README.md#33-database-urls), [3.4](../free-tier/README.md#34-storage-task-photos)). Not verified.
- The Supabase region closest to Argentina (for latency to the DonWeb datacenter) is not verified; check the regions offered when creating the project.
- DonWeb plan details (CPU model, network port, provider-level firewall, backups, snapshots) are not verified; check your plan.
- NATS runs locally with a volume: no Synadia, no `NATS_CREDS`. The outbox of `core` is in memory, so events not yet published are lost on a restart.
- Payments stay `fake` and push notifications off unless you configure them (see `deploy/env/core.env.example`).

## 2. Order of operations

1. VPS preparation (section 3).
2. Domain and DNS (section 4).
3. Supabase: project, roles script, bucket, S3 keys (section 5).
4. Publish the images to GHCR (section 6).
5. Get `deploy/` onto the VPS and write the env files (section 7).
6. First start (section 8).
7. TLS (section 9).
8. Seed the platform admin (section 10).
9. Smoke test (section 11).

## 3. VPS preparation

You run every command yourself on the server. Replace `<user>`, `<ip>` and `<your-ip>`.

### 3.1 SSH key login, no root or password login

From your machine, as the user DonWeb gave you (usually `root`):

```bash
ssh-copy-id root@<ip>                          # or paste your public key into ~/.ssh/authorized_keys
ssh root@<ip>
adduser <user> && usermod -aG sudo <user>
rsync --archive --chown=<user>:<user> ~/.ssh /home/<user>
```

Open a second terminal and check that `ssh <user>@<ip>` and `sudo -v` work before locking the door:

```bash
sudo tee /etc/ssh/sshd_config.d/99-hardening.conf >/dev/null <<'CONF'
PermitRootLogin no
PasswordAuthentication no
CONF
sudo sshd -t && sudo systemctl reload ssh
```

### 3.2 Firewall and automatic security updates

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <your-ip> to any port 22 proto tcp    # or: sudo ufw allow 22/tcp if your IP changes
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose

sudo apt-get update
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

Docker publishes ports by writing its own iptables rules, which bypass `ufw`. This stack publishes only nginx (80 and 443), which is intended; do not add `ports:` to other services.

### 3.3 Docker Engine and Compose

From Docker's apt repository (Ubuntu; check the current instructions at docs.docker.com/engine/install/ubuntu):

```bash
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker <user>        # log out and in again to apply
docker compose version                # must be v2.24 or newer (the compose file uses `required: false`)
```

### 3.4 Swap file (1 GB)

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl --system
free -h
```

### 3.5 Docker log limits

The compose file already caps the logs of its services (10 MB x 3). This sets the same default for any other container:

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
sudo systemctl restart docker
```

## 4. Domain and DNS

Real users need HTTPS (the auth cookies are `Secure`), so you need a domain. Create an `A` record from `<domain>` to the server's public IPv4 and check it resolves before section 9:

```bash
dig +short <domain>
```

## 5. Supabase

Follow these sections of the free-tier guide as written; only the notes differ:

- [3.1 Project](../free-tier/README.md#31-project): pick a region close to the DonWeb datacenter (the best one is not verified).
- [3.2 Roles and schemas](../free-tier/README.md#32-roles-and-schemas-once): creates the `tw_*` schemas and roles.
- [3.3 Database URLs](../free-tier/README.md#33-database-urls): session pooler URLs, `DB_SSL`, `DB_SSL_CA`, `DB_POOL_MAX`. Start with `DB_POOL_MAX=3` for core and `5` for telemetry.
- [3.4 Storage](../free-tier/README.md#34-storage-task-photos): bucket, S3 keys, `S3_*`. The CORS caveat applies, with `https://<domain>` as the browser origin.

The roles script lives in the repo (`backend/postgres/supabase/`); run it from your machine or from a full clone on the VPS.

## 6. Publish the images

The workflow `.github/workflows/publish-images.yml` builds the five images and pushes them to `ghcr.io/<owner>/teamworkflow-<app>` (`core`, `core-migrate`, `telemetry`, `telemetry-migrate`, `frontend`). It is manual only.

1. GitHub > Actions > "Publish images" > Run workflow, on the branch you want to deploy. A manual run normally needs the workflow file on the default branch (not verified for other branches). The optional `tag` input defaults to the short commit SHA; `latest` is always pushed too.
2. The frontend is built for this single-origin setup: `NEXT_PUBLIC_USE_MOCKS=false`, `NEXT_PUBLIC_WS_URL` empty (Socket.IO uses the page origin, nginx serves `/ws`) and `BACKEND_URL=http://nginx`. No domain is baked in, so the same image works on any host.
3. The packages are private by default. Either make each of the five public (GitHub > Packages > Package settings), or log the VPS in with a token that has only `read:packages`:

```bash
echo '<token>' | docker login ghcr.io -u <github-user> --password-stdin
```

## 7. Files and env on the VPS

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/<owner>/<repo>.git teamworkflow
cd teamworkflow
git sparse-checkout set deploy
cd deploy
cp compose.env.example .env
cp env/core.env.example env/core.env
cp env/telemetry.env.example env/telemetry.env
chmod 600 .env env/*.env
```

`git pull` later refreshes the compose and nginx files. A private repo needs a deploy key or a token. For the roles script on the VPS use a full clone or `git sparse-checkout add backend/postgres`.

Set in `.env`:

| Variable | Value |
|----------|-------|
| `GHCR_OWNER` | your GitHub owner, lowercase |
| `IMAGE_TAG` | the tag you published (a short SHA, or `latest`) |

Values specific to this setup in `env/core.env` (everything else keeps the example default):

| Variable | Value |
|----------|-------|
| `PORT` | `3000` |
| `NATS_SERVER` | `nats://nats:4222` (leave `NATS_CREDS` unset) |
| `MIGRATE_ON_START` | `false` (the one-shot migrate services run first) |
| `APP_URL` | `https://<domain>` |
| `COOKIE_SECURE` | remove the line (default `true`) once TLS is on; `false` only for an HTTP infrastructure check |
| `AUTH_DATABASE_URL`, `ORGANIZATION_DATABASE_URL`, `BILLING_DATABASE_URL`, `TASKS_DATABASE_URL`, `NOTIFICATIONS_DATABASE_URL` | Supabase session pooler URLs (free-tier 3.3); comment out the RDS examples |
| `DB_SSL`, `DB_SSL_CA`, `DB_POOL_MAX` | `true`, the CA PEM, `3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Supabase Storage values (free-tier 3.4) |
| `S3_FORCE_PATH_STYLE` | `true` |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `PAYMENT_PROVIDER`, `FCM_ENABLED` | `fake`, `false` unless you configure them |

In `env/telemetry.env`:

| Variable | Value |
|----------|-------|
| `PORT` | `3003` |
| `NATS_SERVER` | `nats://nats:4222` |
| `MIGRATE_ON_START` | `false` |
| `WEB_ORIGIN` | `https://<domain>` (exact origin, no trailing slash) |
| `ATTENDANCE_DATABASE_URL` | Supabase session pooler URL, schema `tw_attendance` |
| `DB_SSL`, `DB_SSL_CA`, `DB_POOL_MAX` | `true`, the CA PEM, `5` |

Do not use `--profile local-db`. The `POSTGRES_PASSWORD` and `*_DB_PASSWORD` variables of `.env` are only for that profile; leave them empty.

## 8. First start

Start over plain HTTP first so a problem is easy to tell from a TLS problem. For this check set `COOKIE_SECURE=false`, `APP_URL=http://<domain>` and `WEB_ORIGIN=http://<domain>`, then fix them in section 9. Real users only after TLS.

```bash
cd ~/teamworkflow/deploy
docker compose pull
docker compose up -d
docker compose ps -a
docker compose logs core-migrate telemetry-migrate        # both must end without errors (exit code 0)
docker compose logs --tail=100 core telemetry nginx
docker stats --no-stream
free -h
```

A failed migration leaves `core` and `telemetry` in `created` state; read the migrate logs (wrong URL, user not `<role>.<projectref>`, roles script not run, missing `DB_SSL`), fix the env and run `docker compose up -d` again. Details: "Run" in [`../README.md`](../README.md#run).

## 9. TLS

Follow "Enable TLS" in [`../README.md`](../README.md#enable-tls-once-a-domain-exists) from step 2 (the DNS record already exists and the firewall already allows 443): issue the certificate with `certbot`, set `COMPOSE_FILE` and `COMPOSE_PROFILES` in `.env`, remove `COOKIE_SECURE=false`, set `APP_URL` and `WEB_ORIGIN` to `https://<domain>`, then `docker compose up -d`. Step 6 there needs nothing: the frontend image has no domain baked in.

## 10. Seed the platform admin

Same procedure as the free-tier guide, [section 8](../free-tier/README.md#8-back-fill-urls-and-seed-the-platform-admin) (step 2): it runs against Supabase from a machine with the repo and Node, not from the VPS (the runner image has no dev dependencies). Run it after `core` started once, so the migrations created the tables. The platform admin only uses `/billing/admin/*`.

## 11. Smoke test

- [ ] `curl -fsS https://<domain>/api/v1/health` and `curl -fsS https://<domain>/api/v1/telemetry/health` answer `{"status":"ok"}`.
- [ ] `docker compose ps -a`: both `*-migrate` exited 0, the rest `running` or `healthy`.
- [ ] Open `https://<domain>`, register an account (new tenant) and log in; a reload keeps the session.
- [ ] Create a site and a shift; clock in succeeds.
- [ ] Tower page (needs the `tower` feature of the plan): the socket connects (Network > WS `/ws` on the same origin) and a new clock-in updates live.
- [ ] Task photo upload works (CORS, free-tier 3.4).
- [ ] The platform admin can log in.
- [ ] `free -h` and `docker stats --no-stream` show no sustained swap use.

## 12. Updates, rollback and maintenance

Update (migrations run first; `pull` and `up -d` recreate changed images):

```bash
cd ~/teamworkflow/deploy
git pull
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<new-tag>/' .env
docker compose pull
docker compose up -d
```

Roll back by setting `IMAGE_TAG` to the previous tag and running `pull` and `up -d`. Migrations are forward-only: a rollback across a schema change needs a forward fix (see the `teamworkflow-prisma-migrations` skill).

Maintenance:

```bash
docker image prune -af --filter "until=168h"     # unused images older than a week
df -h /; docker system df
sudo journalctl --vacuum-time=14d
```

Weekly cron (`crontab -e`): `0 4 * * 0 docker image prune -af --filter "until=168h" >> $HOME/prune.log 2>&1`. Security updates are automatic; kernel updates need a reboot (`sudo reboot`; the containers have `restart: unless-stopped`). Backups: the database is Supabase's concern (check what your plan includes; not verified). Only the NATS volume (JetStream data) and the certificates live on the host.

## 13. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| A container restarts or shows `Exited (137)` | Out of memory (OOM kill). Check `dmesg -T \| grep -i oom` and `docker stats`; confirm swap is on (`free -h`); make sure nothing else runs on the host. Do not raise `mem_limit` past what the host has |
| `up -d` fails, `core` or `telemetry` stays `created` | Migration failed. `docker compose logs core-migrate telemetry-migrate` |
| `max clients reached` / connection errors | Supabase session pooler limit. Lower `DB_POOL_MAX` (core 2, telemetry 3) or raise the pool size in Supabase. How many clients your plan allows is not verified |
| `pull access denied` / `unauthorized` | Packages are private and the VPS is not logged in (section 6), or `GHCR_OWNER` is not lowercase |
| Login works over HTTP but the session is lost | `COOKIE_SECURE=false` missing in the HTTP phase, or still set after TLS (see [`../README.md`](../README.md#http-versus-https-read-before-the-first-login)) |
| Tower socket refused | `WEB_ORIGIN` is not the exact browser origin (scheme and host, no trailing slash) |
| Photo upload fails in the browser | S3 CORS or wrong `S3_*` values; see free-tier 3.4. The presigned URL host must be the Supabase endpoint and the origin `https://<domain>` |
| `Config validation error: invalid or missing X` | Only the variable name is reported. Check `X` in the env file |
| Disk full | `docker system df`, then `docker image prune -af`; check `/var/lib/docker` and the journal |
| Certificate not renewed | `docker compose logs certbot`; port 80 must stay open and the DNS record in place |
