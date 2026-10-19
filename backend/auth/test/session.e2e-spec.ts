import { AUTH_PATTERNS } from '../src/auth/auth.patterns';
import type { TokenPair } from '../src/auth/token.service';
import type { VerifiedActor } from '../src/auth/verified-actor';
import type { CreatedInvitation } from '../src/invitations/invitations.service';
import { AuthE2eApp, startAuthApp } from './support/auth-app';
import { cleanDatabase, closeDatabase, db } from './support/database';

// Covers: S3.3, S3.4, S3.5, S3.6, S3.7, S4.1
describe('session e2e', () => {
  let auth: AuthE2eApp;

  beforeAll(async () => {
    auth = await startAuthApp();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await auth?.close();
    await closeDatabase();
  });

  const owner = {
    tenantName: 'Acme Test',
    name: 'Olivia Owner',
    email: 'olivia@acme.test',
    password: 'owner-password-1',
  };

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
    const registered = await auth.send<TokenPair>(
      AUTH_PATTERNS.register,
      owner,
    );
    expect(registered.accessToken).toEqual(expect.any(String));
    expect(registered.refreshToken).toEqual(expect.any(String));

    const session = await auth.send<TokenPair>(AUTH_PATTERNS.login, {
      email: owner.email,
      password: owner.password,
    });

    const actor = await auth.send<VerifiedActor>(AUTH_PATTERNS.tokenVerify, {
      accessToken: session.accessToken,
    });
    expect(actor).toMatchObject({ role: 'owner', tenantStatus: 'active' });
    expect(actor.tenantId).toEqual(expect.any(String));

    const refreshed = await auth.send<TokenPair>(AUTH_PATTERNS.tokenRefresh, {
      refreshToken: session.refreshToken,
    });
    expect(refreshed.refreshToken).not.toBe(session.refreshToken);

    // Rotation: the old refresh token is revoked and rejected.
    const [oldRow] = await storedRevokedAt(session.refreshToken);
    expect(oldRow.revoked_at).not.toBeNull();
    await expect(
      auth.send(AUTH_PATTERNS.tokenRefresh, {
        refreshToken: session.refreshToken,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_token' });

    await expect(
      auth.send(AUTH_PATTERNS.logout, { refreshToken: refreshed.refreshToken }),
    ).resolves.toEqual({ ok: true });
    await expect(
      auth.send(AUTH_PATTERNS.tokenRefresh, {
        refreshToken: refreshed.refreshToken,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_token' });
    const [newRow] = await storedRevokedAt(refreshed.refreshToken);
    expect(newRow.revoked_at).not.toBeNull();
  });

  it('rejects a wrong password and a duplicate email', async () => {
    await auth.send(AUTH_PATTERNS.register, owner);
    await expect(
      auth.send(AUTH_PATTERNS.login, {
        email: owner.email,
        password: 'wrong-password',
      }),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    await expect(
      auth.send(AUTH_PATTERNS.register, { ...owner, tenantName: 'Other' }),
    ).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('creates an invitation, accepts it and logs in as the invited user', async () => {
    const registered = await auth.send<TokenPair>(
      AUTH_PATTERNS.register,
      owner,
    );
    const ownerActor = await auth.send<VerifiedActor>(
      AUTH_PATTERNS.tokenVerify,
      { accessToken: registered.accessToken },
    );
    const actor = {
      userId: ownerActor.userId,
      tenantId: ownerActor.tenantId,
      role: ownerActor.role,
    };

    const invitation = await auth.send<CreatedInvitation>(
      AUTH_PATTERNS.invitationCreate,
      { actor, email: 'Eve@Acme.test', role: 'employee' },
    );
    expect(invitation.token).toEqual(expect.any(String));

    const accepted = await auth.send<TokenPair>(
      AUTH_PATTERNS.invitationAccept,
      {
        token: invitation.token,
        name: 'Eve Employee',
        password: 'eve-password-1',
      },
    );
    const acceptedActor = await auth.send<VerifiedActor>(
      AUTH_PATTERNS.tokenVerify,
      { accessToken: accepted.accessToken },
    );
    expect(acceptedActor).toMatchObject({
      role: 'employee',
      tenantId: actor.tenantId,
    });

    await expect(
      auth.send<TokenPair>(AUTH_PATTERNS.login, {
        email: 'eve@acme.test',
        password: 'eve-password-1',
      }),
    ).resolves.toMatchObject({ accessToken: expect.any(String) });

    // Single use: the same token cannot be accepted twice.
    await expect(
      auth.send(AUTH_PATTERNS.invitationAccept, {
        token: invitation.token,
        name: 'Eve Again',
        password: 'eve-password-2',
      }),
    ).rejects.toMatchObject({ status: expect.any(Number) });
  });
});
