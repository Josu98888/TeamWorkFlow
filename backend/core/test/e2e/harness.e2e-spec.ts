import { AUTH_PATTERNS } from '../../src/auth/auth.patterns';
import { CoreE2eApp, startCoreApp } from '../support/core-app';
import { cleanDatabase, closeDatabase, db } from '../support/database';

// Covers: S10.1 (harness) and the NATS responder `telemetry` relies on
describe('e2e harness', () => {
  let core: CoreE2eApp;

  beforeAll(async () => {
    await cleanDatabase();
    core = await startCoreApp();
  });

  afterAll(async () => {
    await core?.close();
    await closeDatabase();
  });

  it('runs against the migrated, empty test database', async () => {
    const { rows } = await db().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM auth.tenants',
    );
    expect(rows[0].n).toBe(0);
  });

  it('answers the HTTP error shape { detail, code } under /api', async () => {
    const response = await core.http().get('/api/auth/invitations').expect(401);

    expect(response.body).toEqual({
      detail: expect.any(String) as string,
      code: 'invalid_token',
    });
  });

  it('answers auth.token.verify over NATS with the RPC error shape', async () => {
    await expect(
      core.send(AUTH_PATTERNS.tokenVerify, { accessToken: 'not-a-jwt' }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
      message: expect.any(String) as string,
    });
  });

  it('answers auth.token.verify over NATS with the verified actor', async () => {
    const registered = await core
      .http()
      .post('/api/auth/register')
      .send({
        tenantName: 'Harness Co',
        name: 'Hana Harness',
        email: 'hana@harness.test',
        password: 'harness-password-1',
      })
      .expect(201);

    const actor = await core.send<{ role: string; tenantStatus: string }>(
      AUTH_PATTERNS.tokenVerify,
      { accessToken: (registered.body as { accessToken: string }).accessToken },
    );

    expect(actor).toMatchObject({ role: 'owner', tenantStatus: 'active' });
  });

  it('rejects a malformed NATS payload with 422 validation_error', async () => {
    await expect(
      core.send(AUTH_PATTERNS.tokenVerify, { accessToken: 123 }),
    ).rejects.toMatchObject({ status: 422, code: 'validation_error' });
  });
});
