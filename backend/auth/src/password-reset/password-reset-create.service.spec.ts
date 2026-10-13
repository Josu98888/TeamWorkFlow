import { Test } from '@nestjs/testing';
import { hashToken } from '../common/crypto';
import { ForbiddenException } from '../common/exceptions/app.exceptions';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetCreateService } from './password-reset-create.service';
import type { CreatePasswordResetDto } from './dto/password-reset-create.dto';

jest.mock('../config', () => ({ envs: {} }));
// The generated client is ESM-only; the service only needs its class shape.
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const ACTOR_ID = '0199b7e0-0000-7000-8000-000000000001';
const TARGET_ID = '0199b7e0-0000-7000-8000-000000000002';
const OTHER_ID = '0199b7e0-0000-7000-8000-000000000003';
const HOUR_MS = 60 * 60 * 1000;

type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';
type WireRole = CreatePasswordResetDto['actor']['role'];

interface StoredUser {
  id: string;
  tenantId: string | null;
  role: Role;
  isActive: boolean;
}

interface StoredReset {
  userId: string;
  tokenHash: string;
  createdById: string;
  expiresAt: Date;
  usedAt: Date | null;
}

interface UserWhere {
  id?: string;
  tenantId?: string;
  isActive?: boolean;
}

// Covers: S5.6
describe('PasswordResetCreateService.create', () => {
  let service: PasswordResetCreateService;
  let users: StoredUser[];
  let resets: StoredReset[];
  const userFindFirst = jest.fn();
  const resetUpdateMany = jest.fn();
  const resetCreate = jest.fn();
  const prisma = {
    user: { findFirst: userFindFirst },
    passwordResetToken: { updateMany: resetUpdateMany, create: resetCreate },
    $transaction: jest.fn(),
  };

  function user(overrides: Partial<StoredUser> = {}): StoredUser {
    return {
      id: TARGET_ID,
      tenantId: TENANT_A,
      role: 'EMPLOYEE',
      isActive: true,
      ...overrides,
    };
  }

  function dto(
    actorRole: WireRole = 'admin',
    overrides: Partial<CreatePasswordResetDto['actor']> = {},
  ): CreatePasswordResetDto {
    return {
      actor: {
        userId: ACTOR_ID,
        tenantId: TENANT_A,
        role: actorRole,
        ...overrides,
      },
      userId: TARGET_ID,
    };
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
    jest.resetAllMocks();
    users = [user()];
    resets = [];

    userFindFirst.mockImplementation(({ where }: { where: UserWhere }) =>
      Promise.resolve(
        users.find(
          (u) =>
            (where.id === undefined || u.id === where.id) &&
            (where.tenantId === undefined || u.tenantId === where.tenantId) &&
            (where.isActive === undefined || u.isActive === where.isActive),
        ) ?? null,
      ),
    );
    resetUpdateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { userId: string; usedAt: null };
        data: { usedAt: Date };
      }) => {
        const hits = resets.filter(
          (r) => r.userId === where.userId && r.usedAt === null,
        );
        hits.forEach((r) => (r.usedAt = data.usedAt));
        return Promise.resolve({ count: hits.length });
      },
    );
    resetCreate.mockImplementation(
      ({ data }: { data: Omit<StoredReset, 'usedAt'> }) => {
        resets.push({ ...data, usedAt: null });
        return Promise.resolve({ expiresAt: data.expiresAt });
      },
    );
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) =>
        Promise.resolve(callback(prisma)),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        PasswordResetCreateService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(PasswordResetCreateService);
  });

  describe('creating', () => {
    it('returns the raw token and an ISO expiry one hour ahead', async () => {
      const before = Date.now();

      const result = await service.create(dto());

      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const expiresAt = new Date(result.expiresAt);
      expect(expiresAt.toISOString()).toBe(result.expiresAt);
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + HOUR_MS);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + HOUR_MS);
    });

    it('stores only the token hash, the target and the actor as creator', async () => {
      const { token, expiresAt } = await service.create(dto());

      expect(resets).toHaveLength(1);
      expect(resets[0]).toEqual({
        userId: TARGET_ID,
        tokenHash: hashToken(token),
        createdById: ACTOR_ID,
        expiresAt: new Date(expiresAt),
        usedAt: null,
      });
      expect(JSON.stringify(resets)).not.toContain(token);
    });

    it('reads the target with the actor tenant, inside one transaction', async () => {
      await service.create(dto());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(userFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TARGET_ID, tenantId: TENANT_A, isActive: true },
        }),
      );
    });

    it('a new reset invalidates the previous unused ones of the same user only', async () => {
      const used = new Date('2026-10-01T00:00:00.000Z');
      resets = [
        {
          userId: TARGET_ID,
          tokenHash: 'old-unused',
          createdById: ACTOR_ID,
          expiresAt: new Date(Date.now() + HOUR_MS),
          usedAt: null,
        },
        {
          userId: TARGET_ID,
          tokenHash: 'old-used',
          createdById: ACTOR_ID,
          expiresAt: new Date(Date.now() + HOUR_MS),
          usedAt: used,
        },
        {
          userId: OTHER_ID,
          tokenHash: 'other-user',
          createdById: ACTOR_ID,
          expiresAt: new Date(Date.now() + HOUR_MS),
          usedAt: null,
        },
      ];

      await service.create(dto());

      expect(resets[0].usedAt).toBeInstanceOf(Date);
      expect(resets[1].usedAt).toBe(used);
      expect(resets[2].usedAt).toBeNull();
      expect(resets[3].usedAt).toBeNull();
      expect(resets).toHaveLength(4);
    });

    it('two calls give different tokens', async () => {
      const first = await service.create(dto());
      const second = await service.create(dto());

      expect(first.token).not.toBe(second.token);
    });
  });

  describe('role table', () => {
    it.each([
      ['owner', 'ADMIN'],
      ['owner', 'SUPERVISOR'],
      ['owner', 'EMPLOYEE'],
      ['admin', 'SUPERVISOR'],
      ['admin', 'EMPLOYEE'],
    ] as const)('a %s may reset a %s', async (actorRole, targetRole) => {
      users = [user({ role: targetRole })];

      await expect(service.create(dto(actorRole))).resolves.toHaveProperty(
        'token',
      );
    });

    it.each([
      ['admin', 'ADMIN'],
      ['admin', 'OWNER'],
      ['owner', 'OWNER'],
      ['owner', 'PLATFORM_ADMIN'],
      ['admin', 'PLATFORM_ADMIN'],
    ] as const)('a %s may NOT reset a %s', async (actorRole, targetRole) => {
      users = [user({ role: targetRole })];

      expectForbidden(await errorOf(service.create(dto(actorRole))));

      expect(resetCreate).not.toHaveBeenCalled();
      expect(resetUpdateMany).not.toHaveBeenCalled();
    });

    it.each(['supervisor', 'employee', 'platform_admin'] as const)(
      'an actor with role %s is forbidden before any query',
      async (actorRole) => {
        expectForbidden(await errorOf(service.create(dto(actorRole))));

        expect(userFindFirst).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('an owner/admin actor without a tenant is forbidden before any query', async () => {
      expectForbidden(
        await errorOf(service.create(dto('owner', { tenantId: null }))),
      );

      expect(userFindFirst).not.toHaveBeenCalled();
    });

    it('nobody resets their own password through this action', async () => {
      users = [user({ id: ACTOR_ID, role: 'ADMIN' })];
      const own = dto('owner');
      own.userId = ACTOR_ID;

      expectForbidden(await errorOf(service.create(own)));

      expect(resetCreate).not.toHaveBeenCalled();
    });
  });

  describe('tenant isolation and existence', () => {
    it('an actor of tenant A cannot reset a user of tenant B', async () => {
      users = [user({ tenantId: TENANT_B })];

      expectForbidden(await errorOf(service.create(dto('owner'))));

      expect(resetCreate).not.toHaveBeenCalled();
    });

    it('unknown, other-tenant and inactive users answer the same forbidden', async () => {
      users = [];
      const unknown = await errorOf(service.create(dto()));
      users = [user({ tenantId: TENANT_B })];
      const foreign = await errorOf(service.create(dto()));
      users = [user({ isActive: false })];
      const inactive = await errorOf(service.create(dto()));

      expectForbidden(unknown);
      expect((foreign as ForbiddenException).getError()).toEqual(
        (unknown as ForbiddenException).getError(),
      );
      expect((inactive as ForbiddenException).getError()).toEqual(
        (unknown as ForbiddenException).getError(),
      );
      expect(resetCreate).not.toHaveBeenCalled();
    });
  });
});
