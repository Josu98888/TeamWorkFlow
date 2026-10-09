---
name: teamworkflow-postgres
description: "Trigger: PostgreSQL indexes, @@index in schema.prisma, slow queries, EXPLAIN, query plans, unused/invalid indexes, VACUUM/ANALYZE. Index design and query performance for Prisma + PostgreSQL per microservice."
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "1.0"
  scope: [root, backend]
  auto_invoke:
    - "Creating or modifying PostgreSQL indexes"
    - "Analyzing query performance with EXPLAIN"
    - "Debugging slow queries or missing indexes"
    - "Dropping or reindexing PostgreSQL indexes"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# TeamWorkFlow – PostgreSQL Indexing & Query Performance (Prisma)

## Project Status (READ FIRST)

- Prisma and PostgreSQL are NOT set up yet: no `schema.prisma`, no database container in `backend/docker-compose.yml`, no `PrismaService` (all to create; see teamworkflow-nest "Database Access"). Everything below applies once a microservice owns a database.
- TeamWorkFlow is early stage: tables will be small. Sequential scans on small tables are NORMAL and often faster than index scans. Do not add indexes "just in case".
- Each data-owning microservice has its own Prisma schema and tables (all services share the `teamworkflow` database, each in its own PostgreSQL schema with its own role). Index analysis happens per service, against THAT service's tables. The gateway has no database.
- Check the PostgreSQL version once (`SELECT version();`); some features below depend on it.
- There are no partitioned tables. Do not introduce partitioning without asking the user.
- Conventions assume **Prisma ORM 7** (stable). Verify the installed version before copying schema syntax (`pnpm list prisma`).

### Who owns what

| Topic | Skill |
|-------|-------|
| WHAT to index, validating plans, monitoring, maintenance | **teamworkflow-postgres** (this skill) |
| Declaring models, queries, PrismaService, repositories | teamworkflow-nest |
| HOW to apply indexes safely (migrations, `CONCURRENTLY`, one table per migration) | teamworkflow-prisma-migrations |

---

## Critical Rules

- Design indexes from real queries (the Prisma calls in services/repositories), not from columns.
- Composite index order: **equality columns first, then range / `ORDER BY` columns**.
- Constant filter values (`status = 'pending'`) go in a partial index `WHERE`, not in the key.
- Every FK column is indexed (PostgreSQL does not do it automatically, and Prisma only creates the FK constraint).
- Never assume an index is used: validate with `EXPLAIN (ANALYZE, BUFFERS)` on realistic data volume.
- Every index costs writes, planning time and disk. Prefer one composite index that serves several queries over many single-column ones.
- Index changes go through `schema.prisma` + a Prisma migration (teamworkflow-prisma-migrations). NEVER create or drop indexes by hand in shared environments without a migration (except emergency repairs, then add a migration and `migrate resolve --applied`).
- SQL for analysis runs on development/test databases. Production only with explicit user approval and read-only queries.

---

## Running SQL Safely

### Safety rules

- `EXPLAIN ANALYZE` EXECUTES the query. For `INSERT` / `UPDATE` / `DELETE`, wrap it:
```sql
  BEGIN;
  EXPLAIN (ANALYZE, BUFFERS) UPDATE tasks SET status = 'done' WHERE id = '…';
  ROLLBACK;
```
- `SET enable_seqscan = off` is for a single analysis session only. NEVER in app code, config or migrations.
- Never run `VACUUM FULL` (locks the table) unless the user explicitly asks.

### How to run it

Preferred: `psql` against the service's database (use the `DATABASE_URL` of THAT service; in docker-compose, `docker compose exec <postgres-service> psql -U <user> -d <db>`).

If `psql` is not available, run EXPLAIN through Prisma from a throwaway script. Create it the first time it is needed, and do not commit it:

```typescript
// backend/<service>/scripts/db/explain.ts (to create, read-only helper)
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run against production.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

  // EXPLAIN returns rows with a single "QUERY PLAN" column. The tagged template binds parameters.
  const status = 'pending';
  const plan = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT * FROM tasks WHERE status = ${status} ORDER BY created_at DESC LIMIT 20`;

  for (const row of plan) console.log(row['QUERY PLAN']);
  await prisma.$disconnect();
}

void main();
```

- Use only tagged-template `$queryRaw` (parameters are bound). Never `$queryRawUnsafe` with interpolated input.
- For write statements, either do not use `ANALYZE` or wrap in an interactive `$transaction` that throws at the end to force a rollback.
- Placeholders in EXPLAIN: bound parameters can produce different plans than literals for skewed data. If a plan looks odd, repeat with literals in `psql`.

### Getting the SQL that Prisma runs

Enable query logging on the service's client in development (never commit with `query` logging on in production):

```typescript
// <service>/src/prisma/prisma.service.ts (development variant)
super({
  adapter: new PrismaPg({ connectionString: envs.databaseUrl }),
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'warn' },
    { emit: 'stdout', level: 'error' },
  ],
});
```

```typescript
// in onModuleInit, after $connect()
this.$on('query' as never, (e: { query: string; params: string; duration: number }) => {
  if (e.duration > 100) {
    this.logger.warn(`Slow query (${e.duration}ms): ${e.query} -- params: ${e.params}`);
  }
});
```

- The event exposes `query` (SQL with `$1`, `$2` placeholders), `params`, `duration` (ms) and `target`. The `as never` cast is needed because the `$on` overload depends on the `log` generic of the client; adjust to the installed version's typing.
- Threshold-based logging (e.g. > 100 ms) is how you find candidates for EXPLAIN. Logging every query is for local debugging only: it is noisy and can print personal data in `params`. Gate it behind an env flag.
- Copy the logged SQL, replace `$1…` with realistic values, and run EXPLAIN on it.
- The Prisma client can emit `N+1` patterns as many near-identical queries in a row: that is a code fix (`include`, `in` filters), not an index.

---

## Index Design

### Start from the query

Read the Prisma call and write down its shape:

```typescript
this.prisma.task.findMany({
  where: { status: 'pending' },          // <- equality
  orderBy: { createdAt: 'desc' },        // <- sort
  take: 20, skip: 40,
});
```

```text
WHERE   status = :status            <- equality
ORDER BY created_at DESC            <- sort
LIMIT   20 OFFSET 40
```

-> index `(status, created_at DESC)`.

### Composite order: equality first, then range/sort

```sql
-- Query: WHERE team_id = $1 AND created_at > $2 ORDER BY created_at
-- GOOD: equality column first, range/sort column second
CREATE INDEX "tasks_team_id_created_at_idx" ON "tasks" ("team_id", "created_at");

-- BAD: range column first: the index can't narrow by team_id efficiently
CREATE INDEX "tasks_created_at_team_id_idx" ON "tasks" ("created_at", "team_id");
```

- Leftmost-prefix rule: `(a, b)` serves queries on `a` and on `a + b`, NOT queries only on `b`.
- An index `(a, b)` makes a separate index on `(a)` redundant.

### Partial indexes: constant values go in WHERE

```sql
-- BAD: status in the key: bigger index, worse ordering for the common query
CREATE INDEX "tasks_status_created_at_idx" ON "tasks" ("status", "created_at" DESC);

-- GOOD when the app almost always queries pending tasks
CREATE INDEX "tasks_pending_created_at_idx" ON "tasks" ("created_at" DESC) WHERE "status" = 'pending';
```

The query must include the same condition (`WHERE status = 'pending'`) for the planner to use it. Prisma generates that condition for `where: { status: 'pending' }`; if the value is a bound parameter, the planner may still use the index only when it can prove the match (usually a constant in a generic plan; verify with EXPLAIN).

### FK columns

PostgreSQL indexes the referenced PK but NOT the referencing FK column. Without an index, joins and `ON DELETE CASCADE` scan the whole child table. Every FK gets an index (or is the leading column of a composite index). Prisma does not add it for you: declare `@@index([teamId])`.

### Declaring indexes in `schema.prisma`

Prisma maps index attributes to PostgreSQL. What it supports natively vs what needs raw SQL in the migration:

| Need | In `schema.prisma` | Native? |
|------|--------------------|---------|
| Single / composite B-tree | `@@index([teamId, createdAt])` | Yes |
| Sort direction | `@@index([status, createdAt(sort: Desc)])` | Yes |
| Unique | `@unique` / `@@unique([a, b])` | Yes |
| Explicit database name | `@@index([teamId], map: "ix_tasks_team_id")` | Yes |
| Index type | `@@index([value], type: Hash)` (also `Gin`, `Gist`, `SpGist`, `Brin`) | Yes (PostgreSQL) |
| Operator class | `@@index([payload(ops: JsonbPathOps)], type: Gin)` | Yes for built-in classes |
| Operator class not known to Prisma (`gin_trgm_ops`) | `@@index([brand(ops: raw("gin_trgm_ops"))], type: Gin)` | Yes, via `raw()` (needs the `pg_trgm` extension created in a migration) |
| Partial index / partial unique | `@@index([createdAt(sort: Desc)], where: raw("status = 'pending'"))` | Only with `previewFeatures = ["partialIndexes"]` (preview, Prisma 7.4+); otherwise raw SQL in the migration |
| Covering index (`INCLUDE`) | - | No: raw SQL in the migration |
| Expression index (`lower(email)`) | - | No: raw SQL in the migration |
| CHECK constraint | - | No: raw SQL in the migration |

```prisma
// <service>/prisma/schema.prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
  // previewFeatures = ["partialIndexes"]   // only if the team accepts a preview feature (ask first)
}

model Task {
  id        String   @id @default(uuid(7)) @db.Uuid
  teamId    String   @map("team_id") @db.Uuid
  status    String   @db.VarChar(20)
  title     String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  // Serves: findMany({ where: { teamId }, orderBy: { createdAt: 'desc' } })
  @@index([teamId, createdAt(sort: Desc)], map: "ix_tasks_team_id_created_at")
  // Serves: findMany({ where: { status }, orderBy: { createdAt: 'desc' } })
  @@index([status, createdAt(sort: Desc)], map: "ix_tasks_status_created_at")
  @@map("tasks")
}

model Vehicle {
  id    String @id @default(uuid(7)) @db.Uuid
  brand String

  // "contains" search (contains + mode: 'insensitive' -> ILIKE '%toyo%')
  @@index([brand(ops: raw("gin_trgm_ops"))], type: Gin, map: "ix_vehicles_brand_trgm")
}
```

When the schema cannot express the index, create the migration with `--create-only` and write the SQL by hand (teamworkflow-prisma-migrations):

```sql
-- Partial index (without the preview feature)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ix_tasks_pending_created_at"
    ON "tasks" ("created_at" DESC) WHERE "status" = 'pending';

-- Partial UNIQUE: only one active membership per user + team
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "uq_memberships_user_id_team_id_active"
    ON "memberships" ("user_id", "team_id") WHERE "left_at" IS NULL;

-- Covering (index-only scans): key columns + extra returned columns
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ix_tasks_team_id_incl_status"
    ON "tasks" ("team_id") INCLUDE ("status");

-- Case-insensitive lookup / uniqueness
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "uq_users_email_lower" ON "users" (lower("email"));
-- The query must use the same expression: WHERE lower(email) = lower($1)
```

Important consequences of hand-written indexes:

- Prisma does not know them: keep them out of what you expect Prisma to diff. They exist only in migration SQL; a later `migrate dev` may report drift for objects that cannot be modeled. Always read the generated migration: if Prisma tries to drop one, remove that statement.
- Prisma Client cannot use a partial/expression unique index as a `where: { ... }` unique selector. Query with `findFirst` or handle the violation (`P2002`) in the service.
- A `lower(email)` expression index is only used by queries written in raw SQL or Prisma `mode: 'insensitive'` when the generated SQL matches it (`ILIKE` or `lower()`); verify with EXPLAIN. Often simpler: store emails already lowercased and use a plain unique index.
- Trigram indexes need the `pg_trgm` extension: a migration with `CREATE EXTENSION IF NOT EXISTS pg_trgm;` (may require DB owner privileges: ask the user). They help `ILIKE '%term%'` with 3+ characters.
- Prefix search (`startsWith`) or exact match does NOT need trigram: use a B-tree (an expression index on `lower(col)` with `text_pattern_ops` for case-insensitive prefix, as raw SQL).
- Explicit names: `ix_<table>_<columns>`, `uq_<table>_<columns>[_<condition>]` via `map:`. If you keep Prisma's defaults (`<Table>_<cols>_idx`), do it consistently across the service.

### Other index types

| Need | Index |
|------|-------|
| Equality, ranges, sorting (default) | B-tree |
| `contains` / `ILIKE '%term%'`, fuzzy search | GIN + `gin_trgm_ops` |
| `Json` containment (`path`, `array_contains`), arrays | GIN (`type: Gin`) |
| Equality only on large values | Hash (`type: Hash`), rarely worth it |
| Huge append-only tables ordered by time | BRIN (`type: Brin`; not needed today) |

---

## Over-indexing

Every index adds:

1. **Write cost.** Every INSERT/UPDATE maintains all indexes. Indexing frequently-updated columns also prevents HOT updates (cheap updates that skip index maintenance). Prisma's `@updatedAt` column changes on every update: do NOT index it unless a query truly needs it.
2. **Planning cost.** More indexes = more plans the planner evaluates on every query.
3. **Lock and memory overhead.** Each index is another relation locked per query.
4. **Disk and cache.** Indexes compete with table data for memory.

Rules:

- One composite index serving several queries beats several single-column indexes.
- Don't index low-cardinality columns alone (`status` with 3 values): use them in partial or composite indexes.
- Don't index columns that are never filtered, joined or sorted on.
- Don't add `@@index` automatically for every field Prisma shows; add them from queries.
- Review and drop unused/redundant indexes (see "Monitoring").

---

## Validating with EXPLAIN

### Always validate after adding an index

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM tasks
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 20;
```

Get the real SQL from the Prisma query log (see above) rather than guessing: Prisma selects explicit columns, adds `LIMIT/OFFSET`, and may issue several statements per call (a `findMany` with `include` runs additional queries).

### Reading the plan

| Node | Meaning |
|------|---------|
| `Seq Scan` | Reads the whole table. Fine on small tables; a problem on large ones |
| `Index Scan` | Uses the index, then reads matching rows |
| `Index Only Scan` | Answers from the index alone (best; needs covering index + vacuumed table) |
| `Bitmap Index Scan` + `Bitmap Heap Scan` | Index used for many rows / combined conditions |
| `Sort` above a scan | Ordering not served by an index: consider adding the sort column to it |
| `Nested Loop` with a `Seq Scan` inside | Usually a missing index on a join/FK column |

Also check:

- **Estimated vs actual rows.** Large differences -> stale statistics: run `ANALYZE <table>;`.
- **Buffers** (`shared hit` vs `read`): how much data was touched.
- **Execution Time** vs **Planning Time**.

### Small tables choose Seq Scan

With little data, the planner correctly prefers a sequential scan. To confirm the index CAN be used:

```sql
SET enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS) SELECT …;
SET enable_seqscan = on;   -- always re-enable
```

(Run in a single `psql` session; with the Prisma pool, `SET` may land on a different connection than the next query, so prefer `psql`.)

For real conclusions, test with realistic volume: seed a dev/test database with a script (e.g. tens of thousands of rows via `createMany` or `generate_series`) rather than trusting plans on 50 rows.

A plan visualizer (e.g. explain.dalibo.com or pev) helps with complex plans: don't paste production data into public tools.

---

## Pagination Cost

The `PageDto` (teamworkflow-nest) uses `skip`/`take` + `count`. Fine while tables are small. Watch for:

- **Deep OFFSET**: `skip: 100000` still reads and discards 100000 rows. If deep pages become common, propose keyset pagination with Prisma cursors or a tuple condition:

```typescript
// cursor pagination (Prisma)
this.prisma.task.findMany({
  take: 20,
  skip: 1,
  cursor: { id: lastId },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
});
```

  backed by an index on `(created_at DESC, id DESC)`.
- **`count()` on large tables**: always a scan of matching rows. If it becomes slow, propose an estimate or dropping exact totals for that endpoint; it changes the API contract, so ask first.
- Paginated queries need a deterministic order; index the `orderBy` columns together with the filters.

---

## Monitoring

All queries below run in `psql` or through a read-only `$queryRaw` helper, per service database.

### Indexes per table (for redundancy review)

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

Redundant when: identical definition, or one is a leftmost prefix of another with the same `WHERE` (e.g. `(team_id)` vs `(team_id, created_at)`). Unique indexes and constraint-backing indexes are NOT redundant even if a wider index exists.

### Unused indexes

```sql
SELECT
    s.relname AS table_name,
    s.indexrelname AS index_name,
    s.idx_scan AS scans,
    pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes AS s
JOIN pg_index AS i ON i.indexrelid = s.indexrelid
WHERE NOT i.indisunique
ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC;
-- PostgreSQL 16+: add s.last_idx_scan to see when it was last used
```

Before proposing a drop:

- Stats must cover enough real traffic (>= 1 month in production). Check the last reset:
```sql
  SELECT stats_reset FROM pg_stat_database WHERE datname = current_database();
```
- Check every node that serves queries (primary and replicas, if any).
- Consider infrequent jobs (monthly reports) that may need the index.
- Development databases say nothing about real usage.
- Prisma's `_prisma_migrations` table is infrastructure; ignore it.

### Invalid indexes

```sql
SELECT c.relname AS index_name
FROM pg_class AS c
JOIN pg_index AS i ON i.indexrelid = c.oid
WHERE NOT i.indisvalid;
```

A failed `CREATE INDEX CONCURRENTLY` raises an error AND leaves an INVALID index behind. The planner ignores it, but writes still maintain it. Always check after concurrent builds.

### Index build progress (PostgreSQL 12+)

```sql
SELECT * FROM pg_stat_progress_create_index;
```

### Sizes

```sql
SELECT
    relname AS table_name,
    pg_size_pretty(pg_table_size(relid)) AS table_size,
    pg_size_pretty(pg_indexes_size(relid)) AS indexes_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

### Slow queries

Two levels:

1. **Application level (cheap, start here):** Prisma `query` event with a duration threshold (see "Getting the SQL that Prisma runs"). Identifies which service call is slow.
2. **Server level:** `pg_stat_statements` (extension, requires `shared_preload_libraries`) ranks queries by total time across all clients. Propose enabling it when performance work becomes regular; it is a server config change, ask first. Optionally `log_min_duration_statement` in the PostgreSQL config for the same purpose.

---

## Maintenance

### Invalid index -> rebuild

```sql
REINDEX INDEX CONCURRENTLY "ix_tasks_status_created_at";
```

Interrupted concurrent builds leave temporary indexes:

| Suffix | Meaning | Action |
|--------|---------|--------|
| `_ccnew` | New index being built, incomplete | Drop it, retry `REINDEX ... CONCURRENTLY` |
| `_ccold` | Old index after a successful rebuild | Safe to drop |

```sql
DROP INDEX CONCURRENTLY IF EXISTS "ix_tasks_status_created_at_ccnew";
REINDEX INDEX CONCURRENTLY "ix_tasks_status_created_at";
```

`REINDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` cannot run inside a transaction. A repair done by hand must still end with a migration (or `migrate resolve --applied`) so the history matches reality (teamworkflow-prisma-migrations).

### Bloat

Heavily updated/deleted tables accumulate index bloat; VACUUM reclaims table space but does not compact B-tree pages. Mitigations:

- PostgreSQL 13+ (B-tree deduplication) and 14+ (bottom-up deletion) reduce bloat significantly.
- Avoid indexing frequently-updated columns (keeps updates HOT).
- Tune autovacuum per table for high-churn tables when needed.
- Rebuild with `REINDEX CONCURRENTLY` when an index is clearly bloated (`pgstattuple` extension measures it).

### After large changes

```sql
ANALYZE tasks;            -- refresh planner statistics (cheap)
VACUUM (ANALYZE) tasks;   -- also reclaim dead tuples (heavier on big tables)
```

Run after big backfills, bulk deletes or dropping indexes on large tables.

---

## Dropping Indexes

1. Confirm it is unused or redundant (see "Monitoring").
2. Remove the `@@index` from `schema.prisma` and create a migration (`--create-only`) with `DROP INDEX CONCURRENTLY IF EXISTS "<name>";` as its only statement (teamworkflow-prisma-migrations). There is no `down`: to restore, write a new forward migration that recreates it.
3. Watch query performance after deploying; recreate it with a new migration if plans regress.

---

## Decision Tree

```text
Slow endpoint / query?
├── Get the SQL (Prisma query log with duration threshold, in dev)
├── EXPLAIN (ANALYZE, BUFFERS) on realistic data
│   ├── Seq Scan on a large table -> missing index for WHERE/JOIN
│   ├── Sort node -> add ORDER BY column(s) to the index
│   ├── Nested Loop + Seq Scan -> missing FK/join index
│   ├── Estimated != actual rows -> ANALYZE the table
│   ├── Many near-identical queries in a row -> N+1: fix with include / `in` filter, not an index
│   └── Deep skip / count() -> pagination strategy (ask before changing API)
└── Design index:
    ├── Equality columns first, then range/sort
    ├── Constant filter value? -> partial index (raw SQL or partialIndexes preview)
    ├── Case-insensitive? -> expression index on lower(col) (raw SQL), or store lowercased
    ├── Contains search? -> pg_trgm GIN (@@index with ops: raw("gin_trgm_ops"), type: Gin)
    ├── Returns few extra columns? -> INCLUDE (covering, raw SQL)
    └── Uniqueness only for some rows? -> partial UNIQUE (raw SQL)
-> Declare in schema.prisma (or raw SQL in migration) -> migration (teamworkflow-prisma-migrations) -> EXPLAIN again
```

---

## Checklist

- [ ] Index designed from an actual Prisma query (service/repository code)
- [ ] Equality columns first, then range/sort; constant filters as partial `WHERE`
- [ ] FK columns indexed (`@@index`)
- [ ] No redundant index (leftmost prefix of another) and no low-cardinality single-column index
- [ ] Declared in `schema.prisma` with an explicit, convention-style `map:` name, or documented raw SQL in the migration when Prisma cannot express it
- [ ] Applied through a reviewed Prisma migration (`CONCURRENTLY` on existing tables, in its own migration)
- [ ] Hand-written indexes not dropped by a later generated migration
- [ ] Validated with `EXPLAIN (ANALYZE, BUFFERS)` on realistic volume, using the SQL from the Prisma query log
- [ ] No invalid indexes left after concurrent builds
- [ ] `enable_seqscan` re-enabled; no analysis settings in app code; query logging not left on
- [ ] Write queries analyzed only inside `BEGIN … ROLLBACK`
- [ ] Production touched only with user approval, read-only
