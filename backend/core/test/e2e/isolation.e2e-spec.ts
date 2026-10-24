import { AUTH_PATTERNS } from '../../src/auth/auth.patterns';
import type { CreatedInvitation } from '../../src/auth/invitations/invitations.service';
import type { TokenPair } from '../../src/auth/token.service';
import type { VerifiedActor } from '../../src/auth/verified-actor';
import { bearer, CoreE2eApp, startCoreApp } from '../support/core-app';
import { cleanDatabase, closeDatabase, db } from '../support/database';

interface Member {
  tokens: TokenPair;
  actor: VerifiedActor;
}

// Covers: S5.1 (user management is scoped to the actor's tenant), S4.4
describe('tenant isolation e2e', () => {
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

  async function toMember(tokens: TokenPair): Promise<Member> {
    const actor = await core.send<VerifiedActor>(AUTH_PATTERNS.tokenVerify, {
      accessToken: tokens.accessToken,
    });
    return { tokens, actor };
  }

  async function registerOwner(tag: string) {
    const response = await core
      .http()
      .post('/api/v1/auth/register')
      .send({
        tenantName: `Tenant ${tag}`,
        name: `Owner ${tag}`,
        email: `owner-${tag}@iso.test`,
        password: 'owner-password-1',
      })
      .expect(201);
    return toMember(response.body as TokenPair);
  }

  // Invites and accepts a member; returns the logged-in member.
  async function addMember(
    ownerMember: Member,
    email: string,
    role: 'admin' | 'employee',
  ) {
    const invitation = (
      await core
        .http()
        .post('/api/v1/auth/invitations')
        .set('Authorization', bearer(ownerMember.tokens))
        .send({ email, role })
        .expect(201)
    ).body as CreatedInvitation;
    const accepted = await core
      .http()
      .post('/api/v1/auth/invitations/accept')
      .send({
        token: invitation.token,
        name: 'Fake Member',
        password: 'member-password-1',
      })
      .expect(201);
    return toMember(accepted.body as TokenPair);
  }

  async function userRow(userId: string) {
    const { rows } = await db().query<{ role: string; is_active: boolean }>(
      'SELECT role, is_active FROM auth.users WHERE id = $1',
      [userId],
    );
    return rows[0];
  }

  it('answers 403 forbidden when an admin of tenant A acts on a user of tenant B', async () => {
    const ownerA = await registerOwner('a');
    const ownerB = await registerOwner('b');
    const adminA = await addMember(ownerA, 'admin-a@iso.test', 'admin');
    const employeeB = await addMember(ownerB, 'emp-b@iso.test', 'employee');
    const targetId = employeeB.actor.userId;

    const role = await core
      .http()
      .patch(`/api/v1/auth/users/${targetId}/role`)
      .set('Authorization', bearer(adminA.tokens))
      .send({ role: 'admin' })
      .expect(403);
    expect(role.body).toMatchObject({ code: 'forbidden' });

    const deactivate = await core
      .http()
      .post(`/api/v1/auth/users/${targetId}/deactivate`)
      .set('Authorization', bearer(adminA.tokens))
      .expect(403);
    expect(deactivate.body).toMatchObject({ code: 'forbidden' });

    expect(await userRow(targetId)).toEqual({
      role: 'EMPLOYEE',
      is_active: true,
    });
  });

  it('does not leak the invitations of another tenant', async () => {
    const ownerA = await registerOwner('a');
    const ownerB = await registerOwner('b');
    await core
      .http()
      .post('/api/v1/auth/invitations')
      .set('Authorization', bearer(ownerB.tokens))
      .send({ email: 'pending-b@iso.test', role: 'employee' })
      .expect(201);

    const listA = await core
      .http()
      .get('/api/v1/auth/invitations')
      .set('Authorization', bearer(ownerA.tokens))
      .expect(200);
    expect(listA.body).toEqual([]);

    const listB = await core
      .http()
      .get('/api/v1/auth/invitations')
      .set('Authorization', bearer(ownerB.tokens))
      .expect(200);
    expect((listB.body as { email: string }[]).map((i) => i.email)).toEqual([
      'pending-b@iso.test',
    ]);
  });
});
