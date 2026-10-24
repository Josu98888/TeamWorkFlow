// Test-only configuration of the e2e suite. Everything points at the isolated
// stack of `backend/docker-compose.test.yml`; the dev `.env` is never read.
// Values are throwaway: the database lives on tmpfs.
export const TEST_NATS_PORT = 4223;
export const TEST_DB_PORT = 5433;

const DEV_PORTS = new Set([4222, 5432]);

export const TEST_ENV = {
  PORT: '3000',
  NATS_SERVER: `nats://localhost:${TEST_NATS_PORT}`,
  AUTH_DATABASE_URL: `postgresql://auth_svc:test@localhost:${TEST_DB_PORT}/teamworkflow?schema=auth`,
  JWT_SECRET: 'e2e-only-jwt-secret-not-used-anywhere-else-0123456789',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL: '7d',
} as const;

// Refuses to run when the environment points at anything but the test stack,
// so the suite can never touch the dev NATS (4222) or the dev database (5432).
export function assertTestTargets(env: NodeJS.ProcessEnv = process.env) {
  const natsPorts = (env.NATS_SERVER ?? '')
    .split(',')
    .map((server) => Number(new URL(server.trim()).port));
  const dbPort = Number(new URL(env.AUTH_DATABASE_URL ?? '').port);

  const wrongNats = natsPorts.some((port) => port !== TEST_NATS_PORT);
  const wrongDb = dbPort !== TEST_DB_PORT;
  const dev = [...natsPorts, dbPort].some((port) => DEV_PORTS.has(port));

  if (wrongNats || wrongDb || dev) {
    throw new Error(
      `e2e safety guard: NATS must use port ${TEST_NATS_PORT} and PostgreSQL port ${TEST_DB_PORT} (backend/docker-compose.test.yml), never the dev stack.`,
    );
  }
}

// Overwrites (never merges with) whatever the shell or a `.env` provided.
export function applyTestEnv() {
  Object.assign(process.env, TEST_ENV);
  assertTestTargets();
}
