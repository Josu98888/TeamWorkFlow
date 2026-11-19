// Test-only configuration of the e2e suite. Everything points at the isolated
// stack of `backend/docker-compose.test.yml`; the dev `.env` is never read.
// Values are throwaway: the database lives on tmpfs.
export const TEST_NATS_PORT = 4223;
export const TEST_DB_PORT = 5433;
export const TEST_S3_PORT = 9002;

const DEV_PORTS = new Set([4222, 5432, 8333]);

export const TEST_ENV = {
  PORT: '3000',
  NATS_SERVER: `nats://localhost:${TEST_NATS_PORT}`,
  AUTH_DATABASE_URL: `postgresql://auth_svc:test@localhost:${TEST_DB_PORT}/teamworkflow?schema=auth`,
  ORGANIZATION_DATABASE_URL: `postgresql://organization_svc:test@localhost:${TEST_DB_PORT}/teamworkflow?schema=organization`,
  BILLING_DATABASE_URL: `postgresql://billing_svc:test@localhost:${TEST_DB_PORT}/teamworkflow?schema=billing`,
  TASKS_DATABASE_URL: `postgresql://tasks_svc:test@localhost:${TEST_DB_PORT}/teamworkflow?schema=tasks`,
  NOTIFICATIONS_DATABASE_URL: `postgresql://notifications_svc:test@localhost:${TEST_DB_PORT}/teamworkflow?schema=notifications`,
  FCM_ENABLED: 'false',
  S3_ENDPOINT: `http://localhost:${TEST_S3_PORT}`,
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'teamworkflow-tasks',
  S3_ACCESS_KEY: 'test-s3-access',
  S3_SECRET_KEY: 'test-s3-secret-key',
  S3_FORCE_PATH_STYLE: 'true',
  MEDIA_URL_TTL_SECONDS: '300',
  JWT_SECRET: 'e2e-only-jwt-secret-not-used-anywhere-else-0123456789',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL: '7d',
} as const;

// Refuses to run when the environment points at anything but the test stack,
// so the suite can never touch the dev NATS (4222), database (5432) or S3 emulator (8333).
export function assertTestTargets(env: NodeJS.ProcessEnv = process.env) {
  const natsPorts = (env.NATS_SERVER ?? '')
    .split(',')
    .map((server) => Number(new URL(server.trim()).port));
  const dbPort = Number(new URL(env.AUTH_DATABASE_URL ?? '').port);
  const s3Port = Number(new URL(env.S3_ENDPOINT ?? '').port);

  const wrongNats = natsPorts.some((port) => port !== TEST_NATS_PORT);
  const wrongDb = dbPort !== TEST_DB_PORT;
  const wrongS3 = s3Port !== TEST_S3_PORT;
  const dev = [...natsPorts, dbPort, s3Port].some((port) =>
    DEV_PORTS.has(port),
  );

  if (wrongNats || wrongDb || wrongS3 || dev) {
    throw new Error(
      `e2e safety guard: NATS must use port ${TEST_NATS_PORT}, PostgreSQL port ${TEST_DB_PORT}, and S3 emulator port ${TEST_S3_PORT} (backend/docker-compose.test.yml), never the dev stack.`,
    );
  }
}

// Overwrites (never merges with) whatever the shell or a `.env` provided.
export function applyTestEnv() {
  Object.assign(process.env, TEST_ENV);
  assertTestTargets();
}
