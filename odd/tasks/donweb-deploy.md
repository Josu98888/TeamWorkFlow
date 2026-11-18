# DonWeb VPS deploy

## Objective

Run TeamWorkFlow on one DonWeb Cloud Server (2 vCPU, 2 GB RAM, 20 GB NVMe, 1 TB transfer) with the existing single-host stack in `deploy/` (nginx, NATS, core, telemetry, frontend), PostgreSQL and task media on Supabase.

## Problem and why

The free-tier demo (`odd/tasks/free-tier-deploy.md`) sleeps when idle (crons and NATS consumers stop), splits the app across five platforms and depends on unconfirmed Synadia and Supabase pooler limits. One always-on VPS behind nginx gives one origin, local NATS and no sleep. The database stays managed (Supabase) to avoid running PostgreSQL backups on a 2 GB host.

## Decisions

- **Plan 2 (2 GB).** Always-on memory limits total about 1.34 GB (core 512, telemetry 384, frontend 256, nats 128, nginx 64); plan 1 (1 GB) does not fit, plan 3 (8 GB) is only needed with PostgreSQL or MinIO on the host.
- **No PostgreSQL on the host**: Supabase (session pooler, `tw_` schemas, roles script from the free-tier guide). **Task media**: Supabase Storage (MinIO would cost RAM).
- **NATS local** in compose (no Synadia, no creds).
- **nginx stays the edge gateway** (routing, TLS, WebSocket); no separate API gateway service.
- **Images come from GHCR**, never built on the VPS (a `next build` or `nest build` does not fit in 2 GB).
- **No remote automation from the agent**: the user runs every command on the VPS; no CD job deploys over SSH in this feature.
- OS assumed: Ubuntu 24.04 LTS (confirm the image offered by DonWeb).

## Scope and constraints

- 1 GB swap file is mandatory; prune old images (20 GB disk).
- Supabase pooler connection budget and Storage CORS stay open checks (same as the free-tier guide).
- Push to GHCR needs the workflow on the default branch or a manual dispatch; the user decides when to run it.

## Tasks

- [x] **T1** Image publishing: GitHub Actions workflow that builds and pushes the five images (`core`, `core-migrate`, `telemetry`, `telemetry-migrate`, `frontend`) to GHCR on manual dispatch, with the frontend build args for the single-origin nginx setup. Route: delegated (preparation trigger: reading `ci.yml`, Dockerfiles and frontend build args prepares the write).
- [x] **T2** DonWeb guide `deploy/donweb/README.md`: VPS preparation (SSH key, firewall, Docker, swap, log limits), domain and DNS, Supabase setup (link to the free-tier sections), env files, first start, TLS, updates and rollback, maintenance (prune), smoke test, memory budget; linked from `deploy/README.md` and root `AGENTS.md`. Route: delegated (writer trigger: 2+ non-trivial files).

## Acceptance criteria

- The workflow passes `action-validator`; the guide's env tables match both `env.schema.ts` files and `deploy/env/*.env.example`.
- With the VPS prepared, the user logs in on the domain, uses core and telemetry screens and the Tower receives live updates.

## Checks

TDD: off (no project or session setting). Per task: workflow validation, structural readback of docs; the user runs the real deploy.

## Delivery

Forecast: ~300-450 authored changed lines (docs and one workflow). Strategy: `ask-on-risk`; one PR unless the count exceeds the budget. Branch `feat/deploy/donweb`, stacked on `feat/deploy/free-tier`.

## Progress

- Exploration: `deploy/docker-compose.prod.yml` already supports an external database (the `postgres` service is profile `local-db`); no workflow pushes images to GHCR (`ci.yml` builds with `push: false`; `odd/tasks/ci-cd.md` T5 pending).
- T1 and T2 done (see Evidence).
- Provider change (user decision, 2026-11-18): HostGator VPS in São Paulo (1 vCPU, 2 GB DDR5, 50 GB NVMe, unmetered, KVM + root confirmed in HostGator docs, Ubuntu 22.04 with no panel, no provider backups) instead of DonWeb plan 2, for price (8,100 vs 15,100 ARS per month). The feature keeps its name; the guide moved to `deploy/vps/README.md` and became provider-neutral: section 3.0 upgrades 22.04 to 24.04 on the empty server, the Supabase project goes in the VPS region (São Paulo), control panels are ruled out, and the env files are the only state to keep (password manager).
- Image publishing decision (user, 2026-11-18): the workflow also runs on a pushed version tag `v*` (a push uses the workflow file of the tagged commit, so it works from this branch; `workflow_dispatch` only shows once the file is on the default branch). The image tag is the git tag on a tag push; `latest` is still pushed. The guide uses `IMAGE_TAG=v0.1.0`-style versions and never reuses a tag. Rejected: a temporary branch push trigger (easy to forget), local builds (manual, error-prone), waiting for `main` (PRs target `develop`, branch is stacked). Check: `npx @action-validator/cli` exit 0.
- Branch `feat/deploy/donweb` and tag `v0.1.0` pushed (user confirmed). Run 44314966138 "Publish images": success, all five jobs (core, core-migrate, telemetry, telemetry-migrate, frontend) pushed `v0.1.0` and `latest` to GHCR.
- Recommended: keep the packages private and log the VPS in with a classic token with only `read:packages` and an expiry.
- Next step: the user prepares the VPS (guide section 3), creates the token and follows the guide with `IMAGE_TAG=v0.1.0`.

## Evidence

- **T1**: `.github/workflows/publish-images.yml` (manual dispatch, matrix of five images, `packages: write`, GHA cache per image). Tags: input `tag` (default short SHA) plus `latest` (compose default `IMAGE_TAG`). Frontend build args: `NEXT_PUBLIC_USE_MOCKS=false`, `NEXT_PUBLIC_WS_URL=` (empty, same origin), `BACKEND_URL=http://nginx`; no domain baked, so no workflow input. `npx @action-validator/cli` exits 0. Not verified: a real run (user dispatches it; packages may need to be made public).
- **T2**: `deploy/donweb/README.md` (13 sections, memory budget, VPS prep, env tables, TLS and seed by link, updates, troubleshooting). Linked from `deploy/README.md`, `deploy/free-tier/README.md`, `AGENTS.md`; header comment of `deploy/docker-compose.prod.yml` updated. Check: every env var named in the guide exists in `deploy/env/*.env.example` or `compose.env.example` (rg, none missing); all relative links and anchors resolve. Not verified: DonWeb plan details and image, best Supabase region, pooler client limit, Storage CORS, running the workflow from a non-default branch, a real deploy.
