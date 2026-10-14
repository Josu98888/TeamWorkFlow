import { AUTH_PATTERNS } from '../src/auth/auth.patterns';
import type { TokenPair } from '../src/auth/token.service';
import type { VerifiedActor } from '../src/auth/verified-actor';
import type { CreatedInvitation } from '../src/invitations/invitations.service';
import { AuthE2eApp, startAuthApp } from './support/auth-app';
import { cleanDatabase, closeDatabase, db } from './support/database';

// Covers: S5.1 (user management is scoped to the actor's tenant), S4.4
describe('tenant isolation e2e', () => {
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

  async function registerOwner(tag: string) {
    const tokens = await auth.send<TokenPair>(AUTH_PATTERNS.register, {
      tenantName: `Tenant ${tag}`,
      name: `Owner ${tag}`,
      email: `owner-${tag}@iso.test`,
      password: 'owner-password-1',
    });
    return auth.send<VerifiedActor>(AUTH_PATTERNS.tokenVerify, {
      accessToken: tokens.accessToken,
    });
  }

  const asActor = (a: VerifiedActor) => ({
    userId: a.userId,
    tenantId: a.tenantId,
    role: a.role,
  });

  // Invites and accepts a member; returns the verified actor.
  async function addMember(
    ownerActor: VerifiedActor,
    email: string,
    role: 'admin' | 'employee',
  ) {
    const invitation = await auth.send<CreatedInvitation>(
      AUTH_PATTERNS.invitationCreate,
      { actor: asActor(ownerActor), email, role },
    );
    const tokens = await auth.send<TokenPair>(AUTH_PATTERNS.invitationAccept, {
      token: invitation.token,
      name: 'Fake Member',
      password: 'member-password-1',
    });
    return auth.send<VerifiedActor>(AUTH_PATTERNS.tokenVerify, {
      accessToken: tokens.accessToken,
    });
  }

  async function userRow(userId: string) {
    const { rows } = await db().query<{ role: string; is_active: boolean }>(
      'SELECT role, is_active FROM auth.users WHERE id = $1',
      [userId],
    );
    return rows[0];
  }

  it('answers forbidden when an admin of tenant A acts on a user of tenant B', async () => {
    const ownerA = await registerOwner('a');
    const ownerB = await registerOwner('b');
    const adminA = await addMember(ownerA, 'admin-a@iso.test', 'admin');
    const employeeB = await addMember(ownerB, 'emp-b@iso.test', 'employee');

    await expect(
      auth.send(AUTH_PATTERNS.userChangeRole, {
        actor: asActor(adminA),
        userId: employeeB.userId,
        role: 'admin',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    await expect(
      auth.send(AUTH_PATTERNS.userDeactivate, {
        actor: asActor(adminA),
        userId: employeeB.userId,
      }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });

    expect(await userRow(employeeB.userId)).toEqual({
      role: 'EMPLOYEE',
      is_active: true,
    });
  });

  it('does not leak the invitations of another tenant', async () => {
    const ownerA = await registerOwner('a');
    const ownerB = await registerOwner('b');
    await auth.send(AUTH_PATTERNS.invitationCreate, {
      actor: asActor(ownerB),
      email: 'pending-b@iso.test',
      role: 'employee',
    });

    const listA = await auth.send<{ email: string }[]>(
      AUTH_PATTERNS.invitationList,
      { actor: asActor(ownerA) },
    );
    expect(listA).toEqual([]);
    const listB = await auth.send<{ email: string }[]>(
      AUTH_PATTERNS.invitationList,
      { actor: asActor(ownerB) },
    );
    expect(listB.map((i) => i.email)).toEqual(['pending-b@iso.test']);
  });
});
