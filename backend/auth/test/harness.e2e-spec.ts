import { AUTH_PATTERNS } from '../src/auth/auth.patterns';
import { AuthE2eApp, startAuthApp } from './support/auth-app';
import { cleanDatabase, closeDatabase, db } from './support/database';

// Covers: S10.1
describe('e2e harness', () => {
  let auth: AuthE2eApp;

  beforeAll(async () => {
    await cleanDatabase();
    auth = await startAuthApp();
  });

  afterAll(async () => {
    await auth?.close();
    await closeDatabase();
  });

  it('answers a request-reply pattern over NATS with the error shape', async () => {
    await expect(
      auth.send(AUTH_PATTERNS.tokenVerify, { accessToken: 'not-a-jwt' }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
  });

  it('runs against the migrated, empty test database', async () => {
    const { rows } = await db().query(
      'SELECT count(*)::int AS n FROM auth.tenants',
    );
    expect(rows[0].n).toBe(0);
  });
});
