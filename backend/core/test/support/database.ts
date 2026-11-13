import { Pool } from 'pg';
import { assertTestTargets } from './test-env';

const pools = new Map<string, Pool>();

const SCHEMA_ENV_KEYS = {
  auth: 'AUTH_DATABASE_URL',
  organization: 'ORGANIZATION_DATABASE_URL',
  billing: 'BILLING_DATABASE_URL',
  tasks: 'TASKS_DATABASE_URL',
  notifications: 'NOTIFICATIONS_DATABASE_URL',
} as const;

type SchemaName = keyof typeof SCHEMA_ENV_KEYS;

function getSchemaPool(schema: SchemaName): Pool {
  assertTestTargets();
  const existing = pools.get(schema);
  if (existing) {
    return existing;
  }

  const rawUrl = process.env[SCHEMA_ENV_KEYS[schema]];
  if (!rawUrl) {
    throw new Error(`${SCHEMA_ENV_KEYS[schema]} is not configured for e2e tests`);
  }

  // `?schema=` is a Prisma parameter; each role search_path already targets its schema.
  const url = new URL(rawUrl);
  url.searchParams.delete('schema');
  const created = new Pool({ connectionString: url.toString(), max: 2 });
  pools.set(schema, created);
  return created;
}

// Raw SQL access to the test database, to inspect or seed rows by owning schema.
export function db() {
  return getSchemaPool('auth');
}

export function orgDb() {
  return getSchemaPool('organization');
}

export function billingDb() {
  return getSchemaPool('billing');
}

export function tasksDb() {
  return getSchemaPool('tasks');
}

export function notificationsDb() {
  return getSchemaPool('notifications');
}

async function truncateSchema(schema: SchemaName) {
  if (!process.env[SCHEMA_ENV_KEYS[schema]]) {
    return;
  }
  const clientPool = getSchemaPool(schema);
  const { rows } = await clientPool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = $1 AND tablename <> '_prisma_migrations'`,
    [schema],
  );
  if (rows.length > 0) {
    const tables = rows
      .map(({ tablename }) => `${schema}."${tablename}"`)
      .join(', ');
    await clientPool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  }
}

// Empties every table of each module schema (keeps `_prisma_migrations`).
export async function cleanDatabase() {
  await truncateSchema('auth');
  for (const schema of [
    'organization',
    'billing',
    'tasks',
    'notifications',
  ] as const) {
    try {
      await truncateSchema(schema);
    } catch {
      // Ignore if optional module schema/tables are not initialized yet.
    }
  }
}

export async function closeDatabase() {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}
