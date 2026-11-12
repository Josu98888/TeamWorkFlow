import { AUTH_PATTERNS } from '../../src/auth/auth.patterns';
import type { CreatedInvitation } from '../../src/auth/invitations/invitations.service';
import type { TokenPair } from '../../src/auth/token.service';
import type { VerifiedActor } from '../../src/auth/verified-actor';
import { bearer, CoreE2eApp, startCoreApp } from '../support/core-app';
import { cleanDatabase, closeDatabase, db } from '../support/database';

// Covers: S3.3, S3.4, S3.5, S3.6, S3.7, S4.1 over HTTP
describe('session e2e', () => {
  let core: CoreE2eApp;

  beforeAll(async () => {
    core = await startCoreApp();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await core?.close();
    await closeDatabase();
  });

  const owner = {
    tenantName: 'Acme Test',
    name: 'Olivia Owner',
    email: 'olivia@acme.test',
    password: 'owner-password-1',
  };

  const verify = (tokens: TokenPair) =>
    core.send<VerifiedActor>(AUTH_PATTERNS.tokenVerify, {
      accessToken: tokens.accessToken,
    });

  async function register() {
    const response = await core
      .http()
      .post('/api/v1/auth/register')
      .send(owner)
      .expect(201);
    return response.body as TokenPair;
  }

  // Only the hash of a refresh token is stored (SHA-256, hex).
  async function storedRevokedAt(refreshToken: string) {
    const { rows } = await db().query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM auth.refresh_tokens
       WHERE token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [refreshToken],
    );
    return rows;
  }

  it('registers, logs in, verifies, refreshes (old token rejected) and logs out', async () => {
    const registered = await register();
    expect(registered.accessToken).toEqual(expect.any(String));
    expect(registered.refreshToken).toEqual(expect.any(String));

    const session = (
      await core
        .http()
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: owner.password })
        .expect(201)
    ).body as TokenPair;

    const actor = await verify(session);
    expect(actor).toMatchObject({ role: 'owner', tenantStatus: 'active' });
    expect(actor.tenantId).toEqual(expect.any(String));

    const refreshed = (
      await core
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(201)
    ).body as TokenPair;
    expect(refreshed.refreshToken).not.toBe(session.refreshToken);

    // Rotation: the old refresh token is revoked and rejected.
    const [oldRow] = await storedRevokedAt(session.refreshToken);
    expect(oldRow.revoked_at).not.toBeNull();
    const replay = await core
      .http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    expect(replay.body).toMatchObject({ code: 'invalid_token' });

    // Logout is guarded: it needs the access token as a bearer.
    await core
      .http()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: refreshed.refreshToken })
      .expect(401);
    const loggedOut = await core
      .http()
      .post('/api/v1/auth/logout')
      .set('Authorization', bearer(refreshed))
      .send({ refreshToken: refreshed.refreshToken })
      .expect(201);
    expect(loggedOut.body).toEqual({ ok: true });

    const afterLogout = await core
      .http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refreshed.refreshToken })
      .expect(401);
    expect(afterLogout.body).toMatchObject({ code: 'invalid_token' });
    const [newRow] = await storedRevokedAt(refreshed.refreshToken);
    expect(newRow.revoked_at).not.toBeNull();
  });

  it('rejects a wrong password and a duplicate email', async () => {
    await register();

    const wrong = await core
      .http()
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: 'wrong-password' })
      .expect(401);
    expect(wrong.body).toMatchObject({ code: 'invalid_credentials' });

    const duplicate = await core
      .http()
      .post('/api/v1/auth/register')
      .send({ ...owner, tenantName: 'Other' })
      .expect(409);
    expect(duplicate.body).toMatchObject({ code: 'email_taken' });
  });

  it('rejects a guarded route with a missing or invalid access token', async () => {
    await register();

    const missing = await core.http().get('/api/v1/auth/invitations').expect(401);
    expect(missing.body).toMatchObject({ code: 'invalid_token' });

    const invalid = await core
      .http()
      .get('/api/v1/auth/invitations')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
    expect(invalid.body).toMatchObject({ code: 'invalid_token' });
  });

  it('creates an invitation, accepts it and logs in as the invited user', async () => {
    const registered = await register();
    const ownerActor = await verify(registered);

    const invitation = (
      await core
        .http()
        .post('/api/v1/auth/invitations')
        .set('Authorization', bearer(registered))
        .send({ email: 'Eve@Acme.test', role: 'employee' })
        .expect(201)
    ).body as CreatedInvitation;
    expect(invitation.token).toEqual(expect.any(String));

    const accepted = (
      await core
        .http()
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: invitation.token,
          name: 'Eve Employee',
          password: 'eve-password-1',
        })
        .expect(201)
    ).body as TokenPair;
    expect(await verify(accepted)).toMatchObject({
      role: 'employee',
      tenantId: ownerActor.tenantId,
    });

    const login = await core
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'eve@acme.test', password: 'eve-password-1' })
      .expect(201);
    expect(login.body).toMatchObject({ accessToken: expect.any(String) });

    // Single use: the same token cannot be accepted twice.
    const again = await core.http().post('/api/v1/auth/invitations/accept').send({
      token: invitation.token,
      name: 'Eve Again',
      password: 'eve-password-2',
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(again.body).toMatchObject({ code: expect.any(String) });
  });

  it('never takes the actor from the body', async () => {
    const registered = await register();

    const response = await core
      .http()
      .post('/api/v1/auth/invitations')
      .set('Authorization', bearer(registered))
      .send({
        email: 'mallory@acme.test',
        role: 'employee',
        actor: { userId: 'x', tenantId: 'y', role: 'owner' },
      })
      .expect(422);
    expect(response.body).toMatchObject({ code: 'validation_error' });
  });
});
