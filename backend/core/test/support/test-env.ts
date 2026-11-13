// Test-only configuration of the e2e suite. Everything points at the isolated
// stack of `backend/docker-compose.test.yml`; the dev `.env` is never read.
// Values are throwaway: the database lives on tmpfs.
export const TEST_NATS_PORT = 4223;
export const TEST_DB_PORT = 5433;
export const TEST_MINIO_PORT = 9002;

const DEV_PORTS = new Set([4222, 5432, 9000]);

export const TEST_ENV = {
  PORT: '3000',
  NATS_SERVER: `nats://localhost:${TEST_NATS_PORT}`,
  AUTH_DATABASE_URL: `postgresql://auth_svc:test@localhost:${TEST_DB_PORT}/teamworkflow?schema=auth`,
  ORGANIZATION_DATABASE_URL: `postgresql://organization_svc:test@localhost:${TEST_DB_PORT}/teamworkflow?schema=organization`,
  BILLING_DATABASE_URL: `postgresql://billing_svc:test@localhost:${TEST_DB_PORT}/teamworkflow?schema=billing`,
  TASKS_DATABASE_URL: `postgresql://tasks_svc:test@localhost:${TEST_DB_PORT}/teamworkflow?schema=tasks`,
  S3_ENDPOINT: `http://localhost:${TEST_MINIO_PORT}`,
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'teamworkflow-tasks',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  S3_FORCE_PATH_STYLE: 'true',
  MEDIA_URL_TTL_SECONDS: '300',
  JWT_SECRET: 'e2e-only-jwt-secret-not-used-anywhere-else-0123456789',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL: '7d',
} as const;

// Refuses to run when the environment points at anything but the test stack,
// so the suite can never touch the dev NATS (4222), database (5432) or MinIO (9000).
export function assertTestTargets(env: NodeJS.ProcessEnv = process.env) {
  const natsPorts = (env.NATS_SERVER ?? '')
    .split(',')
    .map((server) => Number(new URL(server.trim()).port));
  const dbPort = Number(new URL(env.AUTH_DATABASE_URL ?? '').port);
  const minioPort = Number(new URL(env.S3_ENDPOINT ?? '').port);

  const wrongNats = natsPorts.some((port) => port !== TEST_NATS_PORT);
  const wrongDb = dbPort !== TEST_DB_PORT;
  const wrongMinio = minioPort !== TEST_MINIO_PORT;
  const dev = [...natsPorts, dbPort, minioPort].some((port) =>
    DEV_PORTS.has(port),
  );

  if (wrongNats || wrongDb || wrongMinio || dev) {
    throw new Error(
      `e2e safety guard: NATS must use port ${TEST_NATS_PORT}, PostgreSQL port ${TEST_DB_PORT}, and MinIO port ${TEST_MINIO_PORT} (backend/docker-compose.test.yml), never the dev stack.`,
    );
  }
}

// Overwrites (never merges with) whatever the shell or a `.env` provided.
export function applyTestEnv() {
  Object.assign(process.env, TEST_ENV);
  assertTestTargets();
}
