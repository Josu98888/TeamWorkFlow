# Amazon S3 for task media, SeaweedFS for local development

## Objective

Production stores task photos in Amazon S3 (the app will be hosted on AWS). Local development and the e2e test stack use SeaweedFS as the S3-compatible emulator.

## Problem / why

`docker compose up` fails: `minio/minio` and `minio/mc` were removed from Docker Hub (Sep 2026) and `quay.io/minio/*` now answers 401. The MinIO community edition is archived. LocalStack now needs an account and auth token. The user hosts on AWS, so production should use real S3 with IAM role credentials, not static keys.

## Scope

- In: `backend/core` S3 config (`src/config/env.schema.ts`, `src/tasks/media/storage.service.ts`) so `S3_ENDPOINT` and static credentials are optional (AWS default endpoint and default credential provider chain when absent); `backend/docker-compose.yml` and `backend/docker-compose.test.yml` switch MinIO to SeaweedFS (`chrislusf/seaweedfs`) with bucket creation; docs (`backend/core/src/tasks/AGENTS.md` env table, any MinIO mentions in docs/skills/STEPS); tests for the new config behavior.
- Out: AWS infrastructure (bucket, IAM role, CORS on the bucket) beyond documenting what production needs; a public endpoint for presigned URLs in local dev (documented as a known gap); `.env` files (agent writes denied: report needed `.env.example` changes to the user).

## Constraints

- Follow `teamworkflow-nest` (config with joi, tests) and `teamworkflow-commits`.
- No static AWS keys in production: absent keys must fall back to the SDK default credential chain (IAM role / instance profile / ECS task role).
- Do not keep `minioadmin` as a production default.

## TDD

Mode: off (no TDD configured for this project). Checks: `pnpm lint` and the touched specs in `backend/core` (`pnpm test src/config src/tasks/media`); `docker compose config -q` for both compose files; a real SeaweedFS start plus bucket creation.

## Tasks

- [x] T1 Core S3 config: optional `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`; `S3_FORCE_PATH_STYLE` default false; `StorageService` passes endpoint and credentials only when set; specs. Route: delegated (writer trigger).
- [x] T2 SeaweedFS in both compose files with bucket init; verified by starting it and creating the bucket. Route: delegated (same writer).
- [ ] T3 Docs: env tables and MinIO mentions; production notes (bucket, IAM policy, bucket CORS for browser presigned PUT). Route: delegated (same writer).

## Acceptance criteria

- `docker compose up` pulls every image; the bucket `teamworkflow-tasks` exists after start.
- With no `S3_ENDPOINT`/keys, the client targets AWS S3 with the default credential chain.
- Lint and touched specs pass; both compose files validate.

## Delivery

Strategy: `single-pr`. Forecast about 250 authored lines. Supersedes the unpushed local branch `fix/docker/minio-images` (Chainguard MinIO), which stays unused.

## Progress

- 2026-11-16: document created on `feat/core/aws-s3-storage` (from `develop` at `95b70f1`). SeaweedFS image `chrislusf/seaweedfs:latest` pulls on the user's machine.
- 2026-11-16: T1 done (route delegated, writer trigger; single writer). Commits: b71d286 60e7750 (storage, config). Observed: pnpm lint clean (warnings only, pre-existing); pnpm test src/config src/tasks 16 suites / 83 tests pass; tsc reports 5 pre-existing errors in unrelated spec/e2e files, none in touched files. Decisions: empty string counts as unset; half-set keys rejected in validateEnvs; requestChecksumCalculation WHEN_REQUIRED added because the SDK default CRC32 over an empty body made presigned PUTs fail with BadDigest on SeaweedFS (also affects real S3).
- 2026-11-16: T2 done (route delegated). Commits: 270bc4f (compose), 74dc174 (e2e harness), 4447620 (spec wording). Observed: docker compose config -q passes for both files; dev stack: seaweedfs + seaweedfs-init started, init exited 0 (200 first run, 409 on rerun), bucket teamworkflow-tasks listed via the AWS SDK, presigned PUT/GET, HeadObject, ListObjectsV2, DeleteObjects all work, wrong keys rejected; test stack (port 9002) same checks pass, then stopped with down (no -v). Old minio and minio-init containers removed with docker rm -f (volumes untouched). Decisions: auth via AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env on the weed server (no JSON config file); bucket created by curl --aws-sigv4 in the same image, no extra image; dev keys default local-s3-access / local-s3-secret-key; dev host port 8333, no console.

## Next step

T3.
