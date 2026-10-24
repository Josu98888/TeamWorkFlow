---
name: teamworkflow-prisma-migrations
description: "Trigger: Prisma migrations, schema.prisma changes, migrate dev/deploy, migration.sql review, adding indexes/columns/constraints, renames, backfills. Safe Prisma Migrate + PostgreSQL rules per data owner (core modules and telemetry)."
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "1.0"
  scope: [root, backend]
  auto_invoke:
    - "Creating or reviewing Prisma migrations"
    - "Changing schema.prisma in any core module or in telemetry"
    - "Adding indexes or constraints to database tables"
    - "Writing data backfill or data migration"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# TeamWorkFlow – Database Migrations (Prisma Migrate + PostgreSQL)

## Project Status (READ FIRST)

- Data owners: the five `core` modules (`auth`, `organization`, `tasks`, `notifications`, `billing`) and `telemetry` (`attendance`). Each has its OWN Prisma schema, client, `prisma/migrations/` history and PostgreSQL schema and role in the shared `teamworkflow` database (`backend/STEPS.md` S1.1, `docs/architecture.md`). The HTTP layer of `core` (the former gateway) has no schema.
- Today only `backend/auth` has Prisma (`prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/20261012011100_init_auth/`, `migration_lock.toml`). It is merged into `backend/core` by task T6 of `odd/tasks/two-service-architecture.md`. `organization`, `tasks`, `notifications`, `billing` and `telemetry` have no Prisma project yet (docs only; to create). Setup is described in teamworkflow-nest ("Database Access"); ask the user before installing.
- Where each `core` module's `prisma/` folder lives (`src/<module>/prisma/` vs a root `prisma/<module>/`) is decided in T6 (gap in `backend/core/AGENTS.md`). Until then, run every Prisma command from inside the folder that holds that owner's `prisma.config.ts` (today `cd backend/auth`; target `backend/core/...` or `backend/telemetry`).
- Connection strings are per owner: `<OWNER>_DATABASE_URL` (`AUTH_`, `ORGANIZATION_`, `TASKS_`, `NOTIFICATIONS_`, `BILLING_`, `ATTENDANCE_DATABASE_URL`; `backend/STEPS.md` S2.4). `backend/auth` still reads `DATABASE_URL` until T6/T7, with `?schema=auth` in the compose URL and the schema also passed explicitly to the `@prisma/adapter-pg` adapter (`backend/auth/src/prisma/prisma.service.ts`); verify how Prisma 7 selects the schema against the Prisma docs, not assumed.
- Conventions here assume **Prisma ORM 7** (stable): connection URL in `prisma.config.ts`, `prisma-client` generator with explicit `output`, driver adapter in the client. Prisma 8 is a release candidate with renamed commands (`db migrate`) and a different client API; do not switch without asking. Verify the installed version: `pnpm list prisma`.
- If an owner has `prisma/` already, read `schema.prisma`, `prisma.config.ts` and `prisma/migrations/` first. Adapt; do not rewrite silently.
- NEVER edit or delete a migration that was already applied in a shared environment (staging, production, a teammate's DB). Create a new one.
- Backend patterns (PrismaService, DTOs): teamworkflow-nest. Index design and `EXPLAIN`: teamworkflow-postgres.

## Why this matters

A bad migration can lock a table and block reads/writes, silently drop data (Prisma generates drop + add for some renames), or leave an owner's history diverged from its database. Prisma Migrate has NO automatic down migrations: recovery is a forward fix.

---

## Critical Rules

- ALWAYS review the generated `prisma/migrations/<timestamp>_<name>/migration.sql` before committing. It is a draft, not a result.
- One concern per migration; name it after the table or change (`create_users_table`, `add_status_index_to_tasks`).
- New table: `CREATE TABLE` + its constraints + its indexes in ONE migration (empty table, instant).
- `CREATE INDEX CONCURRENTLY` on existing tables: its OWN migration, containing ONLY that statement (see "Indexes on existing tables").
- NEVER accept a drop + add when you meant a rename. Edit the SQL to `ALTER TABLE ... RENAME` (see "Renames").
- NOT NULL on an existing table: add nullable -> backfill -> set NOT NULL (unless a constant `DEFAULT` covers existing rows).
- Large backfills NEVER run inside a migration. Use a batched, re-runnable script.
- No downgrades: Prisma has no `migrate down`. Fix forward with a new migration. Destructive changes need expand/contract.
- NEVER `prisma db push` against shared or production databases, and never mix `db push` and `migrate` on the same database.
- `prisma migrate dev` ONLY on local/disposable databases. Staging and production use `prisma migrate deploy` ONLY.
- NEVER run `prisma migrate reset` against anything but a disposable local database, and only after the user agrees.
- One migrations folder per data owner (per `core` module and for `telemetry`). Never copy migrations between owners, never let two owners migrate the same tables (with a shared database, each owner only migrates its own PostgreSQL schema).
- Commit `schema.prisma`, `migration.sql` files and `migration_lock.toml` together. Never `.gitignore` migrations.

---

## Commands: dev vs deploy

| Command | Where | What it does |
|---------|-------|--------------|
| `pnpm exec prisma migrate dev --name <name>` | local dev DB | Diffs schema vs migration history (using a shadow database), writes a new migration, applies it, runs `generate`. May prompt to reset on drift. Warns about data loss |
| `pnpm exec prisma migrate dev --name <name> --create-only` | local dev DB | Writes the migration WITHOUT applying it, so you can hand-edit the SQL first |
| `pnpm exec prisma migrate deploy` | CI, staging, production | Applies pending committed migrations. Non-interactive, never resets, uses an advisory lock so concurrent runs serialize |
| `pnpm exec prisma migrate status` | any | Shows applied/pending/failed migrations and drift against history |
| `pnpm exec prisma migrate resolve --applied <name>` | any | Marks a migration as applied without running it (baselining, manual fix) |
| `pnpm exec prisma migrate resolve --rolled-back <name>` | any | Marks a FAILED migration as rolled back so it can be re-applied after fixing |
| `pnpm exec prisma migrate diff --from-... --to-... --script` | any | Prints SQL for a difference (baselines, SQL preview) |
| `pnpm exec prisma generate` | any | Regenerates the Prisma Client (also part of CI and Docker builds) |
| `pnpm exec prisma validate` / `format` | any | Checks / formats `schema.prisma` |

Connection URL for the CLI comes from `prisma.config.ts` (`env('DATABASE_URL')`). `migrate dev` needs a role allowed to create databases (shadow database); optionally set `datasource.shadowDatabaseUrl` in `prisma.config.ts` when the role cannot.

If Context7 MCP is available, query Prisma docs for command flags before using unfamiliar ones (resolve the library id first).

---

## Workflow

1. Change `prisma/schema.prisma` (teamworkflow-nest for conventions: `@@map`, `@map`, `@@index`).
2. Generate a draft WITHOUT applying it:
```bash
   cd backend/auth
   pnpm exec prisma migrate dev --name create_users_table --create-only
```
3. **Review and edit** `prisma/migrations/<timestamp>_create_users_table/migration.sql` (see "Reviewing Generated SQL").
4. Apply it to the local dev database (also regenerates the client):
```bash
   pnpm exec prisma migrate dev
```
5. Confirm the history and the schema agree:
```bash
   pnpm exec prisma migrate status
```
6. Commit `schema.prisma` + the migration folder in the same change as the code that uses it.
7. Deploy: CI/staging/production run `pnpm exec prisma migrate deploy` BEFORE starting the new `core` or `telemetry` version.

Names: lowercase snake_case, imperative, name the table - `create_tasks_table`, `add_status_index_to_tasks`, `add_score_to_matches`.

If the DB has drifted from the history (someone changed it by hand), `migrate dev` offers to reset: on a local DB accept only if you are sure nothing valuable is inside; on any shared DB STOP and ask the user.

---

## Reviewing Generated SQL

Open `migration.sql` and check every statement:

| Look for | Problem | Fix |
|----------|---------|-----|
| `ALTER TABLE ... DROP COLUMN old` + `ADD COLUMN new` | A rename seen as drop + add -> **data loss** | Replace with `ALTER TABLE ... RENAME COLUMN old TO new` (and use `@map`/`@@map` in the schema to keep the DB name stable instead when possible) |
| `DROP TABLE x` + `CREATE TABLE y` | Table rename -> **data loss** | `ALTER TABLE x RENAME TO y` |
| Statements on several tables | Mixed concerns | Split into separate migrations |
| `CREATE INDEX` on an existing table | Blocks writes while building | Separate migration with `CONCURRENTLY` |
| `ADD COLUMN ... NOT NULL` without `DEFAULT` on an existing table | Fails if the table has rows | Three-step NOT NULL pattern |
| `ALTER COLUMN ... TYPE` | May rewrite the table and lock it | Check that the cast is safe; use `lock_timeout`; ask for large tables |
| `ADD CONSTRAINT ... FOREIGN KEY` on a large existing table | Scans and locks both tables | `NOT VALID` + `VALIDATE` pattern |
| Warning "data loss" printed by `migrate dev` | A column/table with data will be dropped | Stop; use expand/contract, or confirm the data is disposable |
| Empty migration | Nothing changed | Delete the folder |
| Index or constraint names differing from the schema | Prisma re-diffs them next time | Keep Prisma's naming, or set `map:` in the schema to match |
| `CREATE TYPE ... AS ENUM` changes | Enum value changes are DDL | Adding a value is a migration; removing/renaming values needs expand/contract. Prefer Prisma `enum` only for stable sets |

Features Prisma Migrate cannot express in the schema (CHECK constraints, partial indexes without the preview feature, extensions, triggers, expression indexes) go in the SQL file by hand, using `--create-only`. Prisma tracks the history by migration files, so later diffs keep working, but `migrate dev` may report drift for objects it does not know; keep such objects out of what Prisma models, and verify with `migrate status`.

---

## Patterns

### New table (constraints + indexes together)

```sql
-- prisma/migrations/20260315142000_create_tasks_table/migration.sql
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- Empty table: plain index creation is instant, no CONCURRENTLY needed
CREATE INDEX "tasks_team_id_idx" ON "tasks"("team_id");
```

Corresponding schema (for reference):

```prisma
model Task {
  id        String   @id @default(uuid(7)) @db.Uuid
  teamId    String   @map("team_id") @db.Uuid
  title     String   @db.VarChar(200)
  status    String   @default("pending") @db.VarChar(20)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@index([teamId])
  @@map("tasks")
}
```

A foreign key to a table owned by ANOTHER owner (another `core` module or `telemetry`) does not exist: cross-schema references are plain UUID columns (no FK), validated in the service layer through the other module's facade (or, from `telemetry`, a NATS request to `core`), or kept as a local copy fed by events.

### Indexes on existing tables

1. Declare the index in the schema (`@@index`, see teamworkflow-postgres).
2. Generate with `--create-only`.
3. Hand-edit the SQL: add `CONCURRENTLY` and keep ONLY that statement in the file.

```sql
-- prisma/migrations/20260316101500_add_status_index_to_tasks/migration.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tasks_status_created_at_idx" ON "tasks"("status", "created_at" DESC);
```

Why alone in its file: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, and it cannot be combined with other statements that need one. Prisma sends a migration file as a script and (depending on version and database) may wrap it in a transaction: recent Prisma docs state that on PostgreSQL a whole migrate run is applied in one transaction guarded by an advisory lock. Treat `CONCURRENTLY` as something to VERIFY on the installed version: apply it on a local/test database first (`migrate dev` then `migrate status`). If it fails with "cannot run inside a transaction block", ask the user and choose between:

- build the index with a plain `CREATE INDEX` in a maintenance window for small tables (safe while tables are small);
- run `CREATE INDEX CONCURRENTLY` manually with `psql`/`$executeRawUnsafe` outside Prisma, then record the migration with `prisma migrate resolve --applied <name>`, keeping the SQL file in the folder as documentation.

Never apply a manual concurrent build to production without the user's explicit approval.

> If a `CONCURRENTLY` build fails, PostgreSQL leaves an INVALID index with that name, and `IF NOT EXISTS` would skip it. Drop it (`DROP INDEX CONCURRENTLY "<name>"`) before retrying, and check `pg_index.indisvalid` (teamworkflow-postgres, "Invalid indexes").

Tables are small today: a plain `CREATE INDEX` is fine until tables hold real traffic. Do not over-engineer, but write `CONCURRENTLY` migrations from the first big table.

### Adding a NOT NULL column to an existing table

```text
Constant default for existing rows (e.g. false, 0, 'pending')?
├── Yes -> one migration: ADD COLUMN ... NOT NULL DEFAULT <constant>   (PostgreSQL 11+: no table rewrite)
└── No (value must be computed) -> three migrations:
    1. add the column as nullable
    2. backfill (inline if small, script if large — see "Data Migrations")
    3. set NOT NULL
```

```sql
-- One-step, constant default
ALTER TABLE "tasks" ADD COLUMN "is_archived" BOOLEAN NOT NULL DEFAULT false;
```

Three-step: migration 1 `ALTER TABLE ... ADD COLUMN "score" INTEGER;` (schema `Int?`), then backfill, then migration 3 `ALTER TABLE ... ALTER COLUMN "score" SET NOT NULL;` (schema `Int`). Deploy the code that writes the column BEFORE step 3.

### Foreign key on an existing large table (same schema)

```sql
-- Migration 1: add without scanning existing rows
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") NOT VALID;

-- Migration 2: validate (scans, but does not block writes)
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_project_id_fkey";
```

For small tables, the generated plain `ADD CONSTRAINT` is fine. Keep the constraint name Prisma expects (`<table>_<column>_fkey`) so later diffs stay clean.

### Renames

```sql
ALTER TABLE "tasks" RENAME COLUMN "notes" TO "comment";
ALTER TABLE "vehicle_model" RENAME TO "vehicle_models";
```

Alternative with no DDL: keep the database name and rename only the Prisma field with `@map("notes")` (`comment String? @map("notes")`). Renaming code-side is free and safe; prefer it when the DB name does not matter.

### Expand / contract (changes visible to running code)

Once a service runs with more than one instance or without downtime, renames and drops break the old code that is still running. Use:

1. **Expand**: migration adds the new column/table (nullable or defaulted). Old code keeps working.
2. Deploy code that writes BOTH old and new (and reads the new with fallback).
3. **Backfill** existing rows (batched script).
4. Deploy code that uses only the new column.
5. **Contract**: a later migration drops the old column/table.

Never combine expand and contract in one deploy. Each step is its own migration and its own release.

### Lock timeout for risky DDL

For `ALTER TABLE` on tables with real traffic, fail fast instead of queueing behind long transactions:

```sql
SET lock_timeout = '5s';
ALTER TABLE "tasks" ALTER COLUMN "title" TYPE VARCHAR(300);
```

`SET lock_timeout` lasts for the session/transaction running the migration. If the statement fails, fix the cause (find the blocking query) and re-run; do not raise the timeout blindly.

### Extensions and hand-written SQL

```sql
-- migration created with --create-only
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Extensions may need DB owner privileges: ask the user. Hand-written objects (CHECK constraints, triggers, partial indexes without the preview feature) live in `migration.sql` files; add a comment above them explaining why they are manual.

---

## Data Migrations

### Small (< ~10K rows): inline, single statement

```sql
-- prisma/migrations/20260317090000_rename_task_status_new_to_pending/migration.sql
UPDATE "tasks" SET "status" = 'pending' WHERE "status" = 'new';
```

- Plain SQL with constants. Never interpolate values, never depend on application code or the generated client from inside a migration (they change over time, migrations must stay valid forever).
- Single `UPDATE` / `INSERT ... SELECT`, no procedural loops over rows.
- Keep data changes in their own migration, separate from DDL.

### Large: batched script, outside the migration

The migration only changes the schema. The backfill is a separate, re-runnable script run AFTER the migration is applied.

```typescript
// backend/auth/scripts/backfills/backfill-task-scores.ts (to create; run with ts-node)
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const BATCH_SIZE = 500;

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  let processed = 0;
  let lastId = '00000000-0000-0000-0000-000000000000';

  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM tasks WHERE score IS NULL`;
  console.log(`Backfill start: ${count} rows`);

  while (true) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM tasks
      WHERE score IS NULL AND id > ${lastId}::uuid
      ORDER BY id
      LIMIT ${BATCH_SIZE}`;
    if (rows.length === 0) break;

    const ids = rows.map((r) => r.id);
    // One statement per batch = one short transaction: bounded locks, progress survives failures
    await prisma.$executeRaw`
      UPDATE tasks SET score = 0 WHERE id = ANY(${ids}::uuid[]) AND score IS NULL`;

    processed += ids.length;
    lastId = ids[ids.length - 1];
  }

  console.log(`Backfill done: ${processed} processed`);
  await prisma.$disconnect();
}

void main();
```

Rules for backfill scripts:

1. **One short transaction per batch.** Never the whole backfill in one transaction.
2. **Keyset pagination** (`id > :last_id ORDER BY id`), not `OFFSET`.
3. **Idempotent.** Filter on "not yet done" (`score IS NULL`) and use `ON CONFLICT DO NOTHING` for inserts. Safe to re-run after interruption.
4. **Fetch only needed columns.** No full rows.
5. **Log totals at start and end**, not per batch.
6. **Per-item failures:** if rows are processed individually in code, catch, log, count and skip; never let one bad row kill the run.
7. Tagged template `$queryRaw` / `$executeRaw` only (parameters are bound). Never `Unsafe` variants with interpolated input.
8. Location: `backend/<service>/scripts/backfills/<name>.ts`, using ONLY that owner's schema and role. Document the run order in the PR: migrate -> run script -> (next migration, e.g. set NOT NULL).
9. Run first on a copy or local database; production only with the user's explicit approval.

---

## Rollbacks (there are none) and Recovery

- Prisma Migrate has no down migrations. Do not hand-write "down" SQL files; they are never executed.
- To undo a change that is NOT yet applied anywhere shared: delete the migration folder (and revert `schema.prisma`) on your branch; on your local DB use `migrate reset` after the user agrees, or fix with a new migration.
- To undo a change that IS applied: write a new forward migration that reverses it (e.g. drop the index you added). Data dropped by a migration cannot be restored: prevent it with expand/contract and backups.
- Irreversible steps (dropping columns/tables with data) need explicit user confirmation and a prior backup or snapshot.

### Failed migration

- Recent Prisma docs state that on PostgreSQL a failed run rolls back completely (the run is one transaction), but older behavior and `CONCURRENTLY` workarounds can leave a migration recorded as FAILED (error `P3009`/`P3018`). Check with `pnpm exec prisma migrate status`.
- Fix the cause (SQL error, lock timeout, missing extension) by editing the migration ONLY if it was never applied successfully anywhere. Then:
  - Nothing of it was applied: `pnpm exec prisma migrate resolve --rolled-back <name>`, then `migrate deploy` again.
  - It was applied by hand/partially and the schema is now correct: `pnpm exec prisma migrate resolve --applied <name>`.
- Never edit `_prisma_migrations` rows by hand.

### Drift

Drift = the real database differs from what the migration history produces (manual `ALTER`, `db push`, edited migration after apply). `migrate dev` reports it and offers a reset; `migrate status` shows it.

- Local DB: accept the reset after the user agrees, or capture the manual change in a new migration.
- Shared DB: STOP. Find out who changed it and why, then write a migration that matches reality (use `migrate diff` to see the difference) and `migrate resolve --applied` if the change is already there.

### Existing database without migrations (baselining)

If an owner's schema was created with `db push` or by hand:

1. Ask the user first.
2. Introspect or confirm `schema.prisma` matches the DB, then generate a baseline migration of the CURRENT schema:
```bash
   mkdir -p prisma/migrations/0_init
   pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
```
3. Mark the existing DB as up to date without running it:
```bash
   pnpm exec prisma migrate resolve --applied 0_init
```
4. From then on, only migrations change the schema; stop using `db push` on that database.

---

## `db push` policy

- Allowed only for throwaway prototyping on a local database that nobody else uses and that will be reset. Never on staging/production or any shared DB. Never after migrations exist for that database.
- If someone used it on a database that has a migration history, treat it as drift (see above).

---

## Per-owner operations

- Each data owner has its own `<OWNER>_DATABASE_URL`, `prisma.config.ts`, `prisma/migrations/` and `migration_lock.toml`. Migrate each independently; there is no global migration order between owners (inside `core`, deploy runs one `migrate deploy` per module, each with that module's role).
- In `docker-compose.yml` one `postgres` service hosts the `teamworkflow` database with one schema and one role per data owner (`backend/postgres/init/`). Apply migrations as a separate step (a one-shot command or init container running `pnpm exec prisma migrate deploy`), NOT in the service's `start` command when multiple replicas may start at once. `migrate deploy` serializes runs with an advisory lock, but a failing migration should block the release, not crash-loop the app.
- The Docker build must run `pnpm exec prisma generate` before `nest build`.
- Changing a cross-module or cross-service contract is NOT a migration problem: version the event or NATS request payload (teamworkflow-nest) and keep producers and consumers compatible during the rollout.

---

## Decision Tree

```text
Generated by migrate dev?
├── Use --create-only, review the SQL, then apply
└── Hand-written SQL (manual DDL)? Review against the rules anyway

New table?
└── CREATE TABLE + constraints + indexes in ONE migration

Existing table:
├── New index -> own migration, one statement, CREATE INDEX CONCURRENTLY (verify on a local DB)
├── New column
│   ├── nullable -> ADD COLUMN
│   ├── NOT NULL with constant default -> ADD COLUMN ... DEFAULT <constant>
│   └── NOT NULL computed -> add nullable -> backfill -> SET NOT NULL (3 migrations)
├── New FK (same schema only)
│   ├── small table -> plain ADD CONSTRAINT
│   └── large table -> NOT VALID, then VALIDATE (2 migrations)
├── Rename -> RENAME COLUMN / RENAME TO, or @map in the schema (never drop + add)
├── Drop column/table -> expand/contract; contract step in its own later migration
└── Type change -> check rewrite/lock; lock_timeout; ask if the table is large

Data change?
├── < ~10K rows -> inline single UPDATE in its own migration
└── Large -> batched, idempotent script in scripts/backfills/

Something failed or diverged?
├── Failed migration -> migrate status -> fix -> migrate resolve --rolled-back / --applied
└── Drift -> local: reset with consent; shared: stop and ask
```

---

## Review Output Format

When reviewing migrations:

1. List each violation with the rule and a one-line explanation.
2. Show the corrected `migration.sql` file(s), with the folder names in order.
3. If a backfill is involved, show the migration(s) and the script, and the run order.

If the migration passes all checks, say so.

---

## Checklist

- [ ] Draft generated with `--create-only` and reviewed; no hidden drop + add renames
- [ ] One concern / one table per migration; folder named after the change
- [ ] New table: constraints + indexes in the same migration
- [ ] Existing table indexes: separate migration, single `CREATE INDEX CONCURRENTLY` statement (verified locally)
- [ ] NOT NULL / FK on existing tables follow the safe patterns
- [ ] No application code or generated client used inside migration SQL; data changes are plain SQL
- [ ] Large backfills in a batched, idempotent script, not in the migration
- [ ] No down migration expected; forward-fix or expand/contract plan documented for risky changes
- [ ] `migrate dev` only locally; `migrate deploy` for shared environments; no `db push` on shared DBs
- [ ] `prisma migrate status` clean; schema and history agree
- [ ] Migration belongs to the correct data owner (module or telemetry) and only touches that owner's own tables/schema
- [ ] Applied migrations never edited
- [ ] `schema.prisma`, migration folder and `migration_lock.toml` committed together
