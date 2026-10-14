import { Pool } from 'pg';
import { assertTestTargets } from './test-env';

let pool: Pool | undefined;

function getPool() {
  assertTestTargets();
  // `?schema=` is a Prisma parameter; the role search_path already is `auth`.
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.delete('schema');
  pool ??= new Pool({ connectionString: url.toString(), max: 2 });
  return pool;
}

// Raw SQL access to the test database, to seed or inspect rows.
export function db() {
  return getPool();
}

// Empties every table of the `auth` schema (keeps `_prisma_migrations`).
export async function cleanDatabase() {
  const { rows } = await getPool().query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'auth' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) {
    return;
  }
  const tables = rows.map(({ tablename }) => `auth."${tablename}"`).join(', ');
  await getPool().query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

export async function closeDatabase() {
  await pool?.end();
  pool = undefined;
}
