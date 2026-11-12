import { Test } from '@nestjs/testing';
import { hashToken } from '../crypto';
import {
  EmailTakenException,
  ForbiddenException,
} from '../../common/exceptions/app.exceptions';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from './invitations.service';

// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));
jest.mock('../../config', () => ({ envs: {} }));

const NOW = new Date('2026-10-12T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ACTOR_ID = '0199b7e0-0000-7000-8000-000000000001';
const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const OLD_ID = '0199b7e0-0000-7000-8000-0000000000aa';
const NEW_ID = '0199b7e0-0000-7000-8000-0000000000bb';

type WireRole =
  'owner' | 'admin' | 'supervisor' | 'employee' | 'platform_admin';
type StoredRole = 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE';

interface Row {
  id: string;
  tenantId: string;
  email: string;
  role: StoredRole;
  tokenHash: string;
  invitedById: string | null;
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}

interface PendingWhere {
  id: string;
  tenantId: string;
  usedAt: null;
  revokedAt: null;
  expiresAt: { gt: Date };
}

const OLD_TOKEN = 'old-raw-token';

// Covers: S4.3
describe('InvitationsService.regenerate', () => {
  let service: InvitationsService;
  let rows: Row[];
  let users: string[];
  let updateManyCount: number | undefined;
  const findFirst = jest.fn();
  const updateMany = jest.fn();
  const create = jest.fn();
  const userFindUnique = jest.fn();
  const tx = {
    user: { findUnique: userFindUnique },
    invitation: { findFirst, updateMany, create },
  };
  const prisma = { $transaction: jest.fn() };

  function row(overrides: Partial<Row> = {}): Row {
    return {
      id: OLD_ID,
      tenantId: TENANT_A,
      email: 'new@acme.test',
      role: 'EMPLOYEE',
      tokenHash: hashToken(OLD_TOKEN),
      invitedById: null,
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + DAY),
      ...overrides,
    };
  }

  function matches(r: Row, where: PendingWhere): boolean {
    return (
      r.id === where.id &&
      r.tenantId === where.tenantId &&
      r.usedAt === where.usedAt &&
      r.revokedAt === where.revokedAt &&
      r.expiresAt.getTime() > where.expiresAt.gt.getTime()
    );
  }

  function regenerate(
    actorRole: WireRole = 'owner',
    overrides: { tenantId?: string | null; invitationId?: string } = {},
  ) {
    return service.regenerate({
      actor: {
        userId: ACTOR_ID,
        tenantId:
          overrides.tenantId === undefined ? TENANT_A : overrides.tenantId,
        role: actorRole,
      },
      invitationId: overrides.invitationId ?? OLD_ID,
    });
  }

  function errorOf(promise: Promise<unknown>) {
    return promise.then(
      () => {
        throw new Error('Expected the call to fail');
      },
      (error: unknown) => error,
    );
  }

  function expectForbidden(error: unknown) {
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getError()).toEqual(
      expect.objectContaining({ status: 403, code: 'forbidden' }),
    );
  }

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW });
    jest.resetAllMocks();
    rows = [row()];
    users = [];
    updateManyCount = undefined;

    // In-memory table that honours the where/data this service sends.
    findFirst.mockImplementation(({ where }: { where: PendingWhere }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    );
    updateMany.mockImplementation(
      ({ where, data }: { where: PendingWhere; data: { revokedAt: Date } }) => {
        const hit = rows.filter((r) => matches(r, where));
        if (updateManyCount === undefined) {
          hit.forEach((r) => (r.revokedAt = data.revokedAt));
        }
        return Promise.resolve({ count: updateManyCount ?? hit.length });
      },
    );
    create.mockImplementation(({ data }: { data: Omit<Row, 'id'> }) => {
      // Columns the service leaves to the database default.
      const created = { ...data, id: NEW_ID, usedAt: null, revokedAt: null };
      rows.push(created);
      return Promise.resolve({ id: NEW_ID, expiresAt: data.expiresAt });
    });
    userFindUnique.mockImplementation(
      ({ where }: { where: { email: string } }) =>
        Promise.resolve(users.includes(where.email) ? { id: 'u1' } : null),
    );
    prisma.$transaction.mockImplementation(
      (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(InvitationsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('happy path', () => {
    it('returns the new invitation id, a raw token and a 7-day ISO expiry', async () => {
      const result = await regenerate();

      expect(result.invitationId).toBe(NEW_ID);
      expect(result.token.length).toBeGreaterThanOrEqual(40);
      expect(result.expiresAt).toBe(
        new Date(NOW.getTime() + 7 * DAY).toISOString(),
      );
      expect(Object.keys(result).sort()).toEqual([
        'expiresAt',
        'invitationId',
        'token',
      ]);
    });

    it('revokes the old invitation, so its token is no longer accepted', async () => {
      const result = await regenerate();

      const old = rows.find((r) => r.id === OLD_ID);
      expect(old?.revokedAt).toEqual(NOW);
      // The old token matches no pending row; the new one does.
      const pending = rows.filter((r) => r.revokedAt === null);
      expect(pending.map((r) => r.id)).toEqual([NEW_ID]);
      expect(pending.some((r) => r.tokenHash === hashToken(OLD_TOKEN))).toBe(
        false,
      );
      expect(pending[0].tokenHash).toBe(hashToken(result.token));
    });

    it('stores only the hash of the new token', async () => {
      const result = await regenerate();

      const { data } = create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.tokenHash).toBe(hashToken(result.token));
      expect(JSON.stringify(data)).not.toContain(result.token);
    });

    it('keeps tenant, email and role and records the actor as inviter', async () => {
      rows = [row({ role: 'SUPERVISOR', email: 'sup@acme.test' })];

      await regenerate('admin');

      const { data } = create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data).toMatchObject({
        tenantId: TENANT_A,
        email: 'sup@acme.test',
        role: 'SUPERVISOR',
        invitedById: ACTOR_ID,
      });
    });

    it('regenerates an invitation created by the system (no inviter)', async () => {
      rows = [row({ invitedById: null })];

      await expect(regenerate('admin')).resolves.toHaveProperty('token');
    });

    it('revokes the old row and creates the new one in a single transaction', async () => {
      await regenerate();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('scopes both the lookup and the revoke to the tenant of the actor', async () => {
      await regenerate();

      const lookup = findFirst.mock.calls[0][0] as { where: PendingWhere };
      const revoke = updateMany.mock.calls[0][0] as { where: PendingWhere };
      expect(lookup.where).toEqual({
        id: OLD_ID,
        tenantId: TENANT_A,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: NOW },
      });
      expect(revoke.where).toEqual(lookup.where);
    });
  });

  describe('role table (same as creating that invitation)', () => {
    it.each(['ADMIN', 'SUPERVISOR', 'EMPLOYEE'] as const)(
      'owner can regenerate a pending %s invitation',
      async (role) => {
        rows = [row({ role })];

        await expect(regenerate('owner')).resolves.toHaveProperty('token');
      },
    );

    it.each(['SUPERVISOR', 'EMPLOYEE'] as const)(
      'admin can regenerate a pending %s invitation',
      async (role) => {
        rows = [row({ role })];

        await expect(regenerate('admin')).resolves.toHaveProperty('token');
      },
    );

    it('admin regenerating an admin invitation is forbidden and changes nothing', async () => {
      rows = [row({ role: 'ADMIN' })];

      expectForbidden(await errorOf(regenerate('admin')));

      expect(updateMany).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(rows[0].revokedAt).toBeNull();
    });

    it.each(['supervisor', 'employee', 'platform_admin'] as const)(
      '%s is forbidden before any query',
      async (role) => {
        expectForbidden(await errorOf(regenerate(role)));

        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('an actor without a tenant is forbidden before any query', async () => {
      expectForbidden(await errorOf(regenerate('owner', { tenantId: null })));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('tenant isolation', () => {
    it('an invitation of another tenant behaves like an unknown one', async () => {
      rows = [row({ tenantId: TENANT_B })];

      const foreign = await errorOf(regenerate('owner'));
      const unknown = await errorOf(
        regenerate('owner', {
          invitationId: '0199b7e0-0000-7000-8000-0000000000ff',
        }),
      );

      expectForbidden(foreign);
      // Same body for "exists in another tenant" and "does not exist".
      expect((foreign as ForbiddenException).getError()).toEqual(
        (unknown as ForbiddenException).getError(),
      );
      expect(rows[0].revokedAt).toBeNull();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('invitation state', () => {
    it.each([
      ['used', { usedAt: new Date(NOW.getTime() - HOUR) }],
      ['revoked', { revokedAt: new Date(NOW.getTime() - HOUR) }],
      ['expired', { expiresAt: new Date(NOW.getTime() - 1) }],
      ['expiring right now', { expiresAt: NOW }],
    ])('a %s invitation is forbidden', async (_label, overrides) => {
      rows = [row(overrides)];

      expectForbidden(await errorOf(regenerate()));

      expect(create).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('fails with forbidden when another request revoked it first (count 0)', async () => {
      updateManyCount = 0;

      expectForbidden(await errorOf(regenerate()));

      expect(create).not.toHaveBeenCalled();
    });

    it('fails when the revoke does not report exactly one row', async () => {
      updateManyCount = 2;

      expectForbidden(await errorOf(regenerate()));

      expect(create).not.toHaveBeenCalled();
    });

    it('two sequential regenerations of the same id yield one success', async () => {
      await regenerate();

      expectForbidden(await errorOf(regenerate()));
      expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
    });
  });

  describe('email already registered', () => {
    it('fails with email_taken and does not revoke or create', async () => {
      users = ['new@acme.test'];

      const error = await errorOf(regenerate());

      expect(error).toBeInstanceOf(EmailTakenException);
      expect(updateMany).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });
});
