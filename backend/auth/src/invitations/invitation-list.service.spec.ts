import { Test } from '@nestjs/testing';
import { ForbiddenException } from '../common/exceptions/app.exceptions';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from './invitations.service';

// The generated client is ESM-only; the service only needs its class shape.
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));
jest.mock('../config', () => ({ envs: {} }));

const NOW = new Date('2026-10-12T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const ACTOR_ID = '0199b7e0-0000-7000-8000-000000000001';
const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';

type WireRole =
  'owner' | 'admin' | 'supervisor' | 'employee' | 'platform_admin';

interface Row {
  id: string;
  tenantId: string;
  email: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE';
  tokenHash: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

interface FindManyArgs {
  where: {
    tenantId: string;
    usedAt: null;
    revokedAt: null;
    expiresAt: { gt: Date };
  };
  select: Record<string, boolean>;
  orderBy: unknown;
}

// Covers: S4.2
describe('InvitationsService.list', () => {
  let service: InvitationsService;
  let rows: Row[];
  const findMany = jest.fn();
  const prisma = { invitation: { findMany } };

  function row(overrides: Partial<Row> = {}): Row {
    return {
      id: 'inv-1',
      tenantId: TENANT_A,
      email: 'one@acme.test',
      role: 'EMPLOYEE',
      tokenHash: 'secret-hash',
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + HOUR),
      createdAt: new Date(NOW.getTime() - HOUR),
      ...overrides,
    };
  }

  function list(role: WireRole = 'owner', tenantId: string | null = TENANT_A) {
    return service.list({ actor: { userId: ACTOR_ID, tenantId, role } });
  }

  function errorOf(promise: Promise<unknown>) {
    return promise.then(
      () => {
        throw new Error('Expected the call to fail');
      },
      (error: unknown) => error,
    );
  }

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW });
    jest.resetAllMocks();
    rows = [row()];
    // In-memory table that honours the where/select/orderBy this service sends.
    findMany.mockImplementation(({ where, select }: FindManyArgs) => {
      const matches = rows
        .filter(
          (r) =>
            r.tenantId === where.tenantId &&
            r.usedAt === null &&
            r.revokedAt === null &&
            r.expiresAt.getTime() > where.expiresAt.gt.getTime(),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Promise.resolve(
        matches.map((r) =>
          Object.fromEntries(
            Object.keys(select)
              .filter((key) => select[key])
              .map((key) => [key, r[key as keyof Row]]),
          ),
        ),
      );
    });

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

  it('returns objects with exactly invitationId, email, role and expiresAt', async () => {
    const result = await list();

    expect(result).toEqual([
      {
        invitationId: 'inv-1',
        email: 'one@acme.test',
        role: 'employee',
        expiresAt: new Date(NOW.getTime() + HOUR).toISOString(),
      },
    ]);
    expect(Object.keys(result[0]).sort()).toEqual([
      'email',
      'expiresAt',
      'invitationId',
      'role',
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-hash');
  });

  it('never selects tokenHash', async () => {
    await list();

    const { select } = findMany.mock.calls[0][0] as FindManyArgs;
    expect(select).not.toHaveProperty('tokenHash');
    expect(Object.keys(select).sort()).toEqual([
      'email',
      'expiresAt',
      'id',
      'role',
    ]);
  });

  it('filters by the tenant of the actor and by the pending conditions', async () => {
    await list();

    const { where } = findMany.mock.calls[0][0] as FindManyArgs;
    expect(where).toEqual({
      tenantId: TENANT_A,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: NOW },
    });
  });

  it('never returns invitations of another tenant', async () => {
    rows = [
      row({ id: 'a1', tenantId: TENANT_A, email: 'a@acme.test' }),
      row({ id: 'b1', tenantId: TENANT_B, email: 'b@other.test' }),
    ];

    const forA = await list('owner', TENANT_A);
    const forB = await list('admin', TENANT_B);

    expect(forA.map((i) => i.invitationId)).toEqual(['a1']);
    expect(forB.map((i) => i.invitationId)).toEqual(['b1']);
  });

  it('excludes used, revoked and expired invitations', async () => {
    rows = [
      row({ id: 'pending' }),
      row({ id: 'used', usedAt: new Date(NOW.getTime() - HOUR) }),
      row({ id: 'revoked', revokedAt: new Date(NOW.getTime() - HOUR) }),
      row({ id: 'expired', expiresAt: new Date(NOW.getTime() - 1) }),
      row({ id: 'expires-now', expiresAt: NOW }),
    ];

    const result = await list();

    expect(result.map((i) => i.invitationId)).toEqual(['pending']);
  });

  it('lists the newest invitation first', async () => {
    rows = [
      row({ id: 'old', createdAt: new Date(NOW.getTime() - 3 * HOUR) }),
      row({ id: 'new', createdAt: new Date(NOW.getTime() - HOUR) }),
    ];

    const result = await list();

    expect(result.map((i) => i.invitationId)).toEqual(['new', 'old']);
    const { orderBy } = findMany.mock.calls[0][0] as FindManyArgs;
    expect(orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('maps every invited role to its wire value', async () => {
    rows = [
      row({ id: '1', role: 'ADMIN' }),
      row({ id: '2', role: 'SUPERVISOR' }),
      row({ id: '3', role: 'EMPLOYEE' }),
    ];

    const result = await list();

    expect(result.map((i) => i.role).sort()).toEqual([
      'admin',
      'employee',
      'supervisor',
    ]);
  });

  it('returns an empty array when nothing is pending', async () => {
    rows = [];

    await expect(list()).resolves.toEqual([]);
  });

  describe('authorization', () => {
    it.each(['owner', 'admin'] as const)('%s can list', async (role) => {
      await expect(list(role)).resolves.toHaveLength(1);
    });

    it.each(['supervisor', 'employee', 'platform_admin'] as const)(
      '%s is forbidden',
      async (role) => {
        const error = await errorOf(list(role));

        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getError()).toEqual(
          expect.objectContaining({ status: 403, code: 'forbidden' }),
        );
        expect(findMany).not.toHaveBeenCalled();
      },
    );

    it('an actor without a tenant is forbidden', async () => {
      expect(await errorOf(list('owner', null))).toBeInstanceOf(
        ForbiddenException,
      );
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});
