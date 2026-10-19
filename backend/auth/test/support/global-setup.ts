import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { applyTestEnv, TEST_DB_PORT, TEST_NATS_PORT } from './test-env';

const START_HINT =
  'Start it from the repo root with: docker compose -f backend/docker-compose.test.yml up -d --wait';

function isReachable(port: number, timeoutMs = 2_000) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: 'localhost', port });
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

// Jest `globalSetup`: runs once before the suite.
export default async function globalSetup() {
  applyTestEnv();

  const [nats, db] = await Promise.all([
    isReachable(TEST_NATS_PORT),
    isReachable(TEST_DB_PORT),
  ]);
  const down = [
    nats ? null : `NATS (localhost:${TEST_NATS_PORT})`,
    db ? null : `PostgreSQL (localhost:${TEST_DB_PORT})`,
  ].filter(Boolean);
  if (down.length > 0) {
    throw new Error(
      `The e2e test stack is not reachable: ${down.join(', ')}. ${START_HINT}`,
    );
  }

  // Test database only: applyTestEnv() just pinned DATABASE_URL to port 5433.
  execFileSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    { env: process.env, stdio: 'inherit' },
  );
}
