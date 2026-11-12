import { Pool } from 'pg';
import { assertTestTargets } from './test-env';

let pool: Pool | undefined;
let tasksPool: Pool | undefined;

function getPool() {
  assertTestTargets();
  // `?schema=` is a Prisma parameter; the role search_path already is `auth`.
  const url = new URL(process.env.AUTH_DATABASE_URL!);
  url.searchParams.delete('schema');
  pool ??= new Pool({ connectionString: url.toString(), max: 2 });
  return pool;
}

function getTasksPool() {
  assertTestTargets();
  const url = new URL(process.env.TASKS_DATABASE_URL!);
  url.searchParams.delete('schema');
  tasksPool ??= new Pool({ connectionString: url.toString(), max: 2 });
  return tasksPool;
}

// Raw SQL access to the test database, to inspect rows.
export function db() {
  return getPool();
}

export function tasksDb() {
  return getTasksPool();
}

// Empties every table of the `auth` and `tasks` schemas (keeps `_prisma_migrations`).
export async function cleanDatabase() {
  const { rows } = await getPool().query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'auth' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length > 0) {
    const tables = rows.map(({ tablename }) => `auth."${tablename}"`).join(', ');
    await getPool().query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  }

  if (process.env.TASKS_DATABASE_URL) {
    try {
      const { rows: taskRows } = await getTasksPool().query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'tasks' AND tablename <> '_prisma_migrations'`,
      );
      if (taskRows.length > 0) {
        const tables = taskRows.map(({ tablename }) => `tasks."${tablename}"`).join(', ');
        await getTasksPool().query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
      }
    } catch {
      // Ignore if tasks schema/tables not initialized
    }
  }
}

export async function closeDatabase() {
  await Promise.all([pool?.end(), tasksPool?.end()]);
  pool = undefined;
  tasksPool = undefined;
}
