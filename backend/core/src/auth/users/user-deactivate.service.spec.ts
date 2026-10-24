import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';
import { hashPassword, hashToken } from '../crypto';
import {
  ForbiddenException,
  InvalidCredentialsException,
  InvalidTokenException,
} from '../../common/exceptions/app.exceptions';
import { envs } from '../../config';
import { AUTH_EVENTS } from '../events/auth.events';
import { JetStreamService } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserDeactivateService } from './user-deactivate.service';
import type { DeactivateUserDto } from './dto/user-deactivate.dto';

jest.mock('../../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const ACTOR_ID = '0199b7e0-0000-7000-8000-000000000001';
const TARGET_ID = '0199b7e0-0000-7000-8000-000000000002';
const OTHER_ID = '0199b7e0-0000-7000-8000-000000000003';
const PASSWORD = 'correct horse battery';
const FUTURE = new Date('2027-01-01T00:00:00.000Z');

type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';
type WireRole = DeactivateUserDto['actor']['role'];

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  tenantId: string | null;
  role: Role;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  siteIds: string[];
}

interface StoredToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface UserWhere {
  id?: string;
  email?: string;
  tenantId?: string;
  isActive?: boolean;
  role?: Role;
}

function matches(user: StoredUser, where: UserWhere): boolean {
  return (
    (where.id === undefined || user.id === where.id) &&
    (where.email === undefined || user.email === where.email) &&
    (where.tenantId === undefined || user.tenantId === where.tenantId) &&
    (where.isActive === undefined || user.isActive === where.isActive) &&
    (where.role === undefined || user.role === where.role)
  );
}

function token(overrides: Partial<StoredToken>): StoredToken {
  return {
    id: 't',
    userId: TARGET_ID,
    tokenHash: 'h',
    expiresAt: FUTURE,
    revokedAt: null,
    ...overrides,
  };
}

// Covers: S5.4
describe('UserDeactivateService.deactivate', () => {
  let passwordHash: string;
  let service: UserDeactivateService;
  let auth: AuthService;
  let tokens: TokenService;
  let users: StoredUser[];
  let refreshTokens: StoredToken[];
  let userUpdateCount: number | undefined;
  const publish = jest.fn();
  const userFindFirst = jest.fn();
  const userUpdateMany = jest.fn();
  const tokenUpdateMany = jest.fn();
  const prisma = {
    user: {
      findFirst: userFindFirst,
      findUnique: jest.fn(),
      updateMany: userUpdateMany,
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: tokenUpdateMany,
    },
    $transaction: jest.fn(),
  };

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  function user(overrides: Partial<StoredUser> = {}): StoredUser {
    return {
      id: TARGET_ID,
      email: 'target@example.com',
      passwordHash,
      tenantId: TENANT_A,
      role: 'EMPLOYEE',
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      siteIds: [],
      ...overrides,
    };
  }

  function dto(
    actorRole: WireRole = 'admin',
    overrides: Partial<DeactivateUserDto['actor']> = {},
  ): DeactivateUserDto {
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

  const tenantOf = () => ({ status: 'ACTIVE', plan: 'PRO', features: {} });

  beforeEach(async () => {
    jest.resetAllMocks();
    users = [user()];
    refreshTokens = [];
    userUpdateCount = undefined;

    // One in-memory store behind every query that login, refresh and verify
    // make, so the spec runs the real AuthService against the deactivated row.
    userFindFirst.mockImplementation(({ where }: { where: UserWhere }) =>
      Promise.resolve(users.find((u) => matches(u, where)) ?? null),
    );
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: UserWhere }) => {
        const found = users.find((u) => matches(u, where));
        return Promise.resolve(found ? { ...found, tenant: tenantOf() } : null);
      },
    );
    prisma.user.update.mockResolvedValue({ failedLoginAttempts: 0 });
    userUpdateMany.mockImplementation(
      ({ where, data }: { where: UserWhere; data: Partial<StoredUser> }) => {
        const hits = users.filter((u) => matches(u, where));
        if (userUpdateCount === undefined) {
          hits.forEach((u) => Object.assign(u, data));
        }
        return Promise.resolve({ count: userUpdateCount ?? hits.length });
      },
    );
    prisma.refreshToken.create.mockImplementation(
      ({ data }: { data: Omit<StoredToken, 'id' | 'revokedAt'> }) => {
        const row = token({ id: `token-${refreshTokens.length + 1}`, ...data });
        refreshTokens.push(row);
        return Promise.resolve(row);
      },
    );
    prisma.refreshToken.findUnique.mockImplementation(
      ({ where }: { where: { tokenHash: string } }) => {
        const row = refreshTokens.find((t) => t.tokenHash === where.tokenHash);
        const owner = users.find((u) => u.id === row?.userId);
        return Promise.resolve(
          row && owner
            ? { ...row, user: { ...owner, tenant: tenantOf() } }
            : null,
        );
      },
    );
    tokenUpdateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id?: string; userId?: string; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        const hits = refreshTokens.filter(
          (t) =>
            (where.id === undefined || t.id === where.id) &&
            (where.userId === undefined || t.userId === where.userId) &&
            t.revokedAt === null,
        );
        hits.forEach((t) => (t.revokedAt = data.revokedAt));
        return Promise.resolve({ count: hits.length });
      },
    );
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) =>
        Promise.resolve(callback(prisma)),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: envs.jwtSecret,
          signOptions: { algorithm: 'HS256' },
        }),
      ],
      providers: [
        UserDeactivateService,
        AuthService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: JetStreamService, useValue: { publish } },
      ],
    }).compile();
    service = moduleRef.get(UserDeactivateService);
    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(TokenService);
  });

  describe('deactivating', () => {
    it('sets isActive=false and keeps the row', async () => {
      await expect(service.deactivate(dto())).resolves.toEqual({ ok: true });

      expect(users).toHaveLength(1);
      expect(users[0].isActive).toBe(false);
    });

    it('revokes every active refresh token of the user and only theirs', async () => {
      const alreadyRevoked = new Date('2026-10-01T00:00:00.000Z');
      refreshTokens = [
        token({ id: 't1', tokenHash: 'h1' }),
        token({ id: 't2', tokenHash: 'h2' }),
        token({ id: 't3', tokenHash: 'h3', revokedAt: alreadyRevoked }),
        token({ id: 't4', tokenHash: 'h4', userId: OTHER_ID }),
      ];

      await service.deactivate(dto());

      expect(refreshTokens[0].revokedAt).toBeInstanceOf(Date);
      expect(refreshTokens[1].revokedAt).toBeInstanceOf(Date);
      expect(refreshTokens[2].revokedAt).toBe(alreadyRevoked);
      expect(refreshTokens[3].revokedAt).toBeNull();
    });

    it('does both writes inside one transaction, scoped to the actor tenant', async () => {
      await service.deactivate(dto());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(userFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TARGET_ID, tenantId: TENANT_A, isActive: true },
        }),
      );
      expect(userUpdateMany).toHaveBeenCalledWith({
        where: {
          id: TARGET_ID,
          tenantId: TENANT_A,
          isActive: true,
          role: 'EMPLOYEE',
        },
        data: { isActive: false },
      });
      expect(tokenUpdateMany).toHaveBeenCalledWith({
        where: { userId: TARGET_ID, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('publishes user_deactivated once, after the transaction', async () => {
      let committed = false;
      prisma.$transaction.mockImplementation(
        async (callback: (tx: typeof prisma) => unknown) => {
          const result = await callback(prisma);
          committed = true;
          return result;
        },
      );
      publish.mockImplementation(() => {
        expect(committed).toBe(true);
        return Promise.resolve();
      });

      await service.deactivate(dto());

      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(
        TENANT_A,
        AUTH_EVENTS.userDeactivated,
        { userId: TARGET_ID, tenantId: TENANT_A, actorId: ACTOR_ID },
      );
    });
  });

  describe('a deactivated user is rejected everywhere (real AuthService)', () => {
    function session() {
      return tokens.issueTokenPair({
        id: TARGET_ID,
        tenantId: TENANT_A,
        role: 'EMPLOYEE',
      });
    }

    it('works before deactivation (control)', async () => {
      const pair = await session();

      await expect(
        auth.login({ email: 'target@example.com', password: PASSWORD }),
      ).resolves.toHaveProperty('accessToken');
      await expect(
        auth.verify({ accessToken: pair.accessToken }),
      ).resolves.toMatchObject({ userId: TARGET_ID });
      await expect(
        auth.refresh({ refreshToken: pair.refreshToken }),
      ).resolves.toHaveProperty('refreshToken');
    });

    it('login with the correct password fails with invalid_credentials', async () => {
      await service.deactivate(dto());

      const error = await errorOf(
        auth.login({ email: 'target@example.com', password: PASSWORD }),
      );

      expect(error).toBeInstanceOf(InvalidCredentialsException);
    });

    it('refresh with a token issued before fails with invalid_token', async () => {
      const pair = await session();

      await service.deactivate(dto());

      const error = await errorOf(
        auth.refresh({ refreshToken: pair.refreshToken }),
      );
      expect(error).toBeInstanceOf(InvalidTokenException);
      // Revoked in the store, not only rejected because the user is inactive.
      expect(
        refreshTokens.find((t) => t.tokenHash === hashToken(pair.refreshToken))
          ?.revokedAt,
      ).toBeInstanceOf(Date);
    });

    it('verify with an access token issued before fails with invalid_token', async () => {
      const pair = await session();

      await service.deactivate(dto());

      const error = await errorOf(
        auth.verify({ accessToken: pair.accessToken }),
      );
      expect(error).toBeInstanceOf(InvalidTokenException);
    });
  });

  describe('role table', () => {
    it.each([
      ['owner', 'ADMIN'],
      ['owner', 'SUPERVISOR'],
      ['owner', 'EMPLOYEE'],
      ['admin', 'SUPERVISOR'],
      ['admin', 'EMPLOYEE'],
    ] as const)('a %s may deactivate a %s', async (actorRole, targetRole) => {
      users = [user({ role: targetRole })];

      await expect(service.deactivate(dto(actorRole))).resolves.toEqual({
        ok: true,
      });

      expect(users[0].isActive).toBe(false);
    });

    it.each([
      ['admin', 'ADMIN'],
      ['admin', 'OWNER'],
      ['owner', 'OWNER'],
      ['owner', 'PLATFORM_ADMIN'],
      ['admin', 'PLATFORM_ADMIN'],
    ] as const)(
      'a %s may NOT deactivate a %s',
      async (actorRole, targetRole) => {
        users = [user({ role: targetRole })];

        expectForbidden(await errorOf(service.deactivate(dto(actorRole))));

        expect(users[0].isActive).toBe(true);
        expect(tokenUpdateMany).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      },
    );

    it.each(['supervisor', 'employee', 'platform_admin'] as const)(
      'an actor with role %s is forbidden before any query',
      async (actorRole) => {
        expectForbidden(await errorOf(service.deactivate(dto(actorRole))));

        expect(userFindFirst).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('an owner/admin actor without a tenant is forbidden before any query', async () => {
      expectForbidden(
        await errorOf(service.deactivate(dto('owner', { tenantId: null }))),
      );

      expect(userFindFirst).not.toHaveBeenCalled();
    });

    it('nobody deactivates themselves', async () => {
      users = [user({ id: ACTOR_ID, role: 'ADMIN' })];
      const own = dto('owner');
      own.userId = ACTOR_ID;

      expectForbidden(await errorOf(service.deactivate(own)));

      expect(users[0].isActive).toBe(true);
    });
  });

  describe('tenant isolation and existence', () => {
    it('an actor of tenant A cannot deactivate a user of tenant B', async () => {
      users = [user({ tenantId: TENANT_B })];

      expectForbidden(await errorOf(service.deactivate(dto('owner'))));

      expect(users[0].isActive).toBe(true);
      expect(userUpdateMany).not.toHaveBeenCalled();
      expect(tokenUpdateMany).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('unknown and other-tenant users answer the same forbidden', async () => {
      users = [];
      const unknown = await errorOf(service.deactivate(dto()));
      users = [user({ tenantId: TENANT_B })];
      const foreign = await errorOf(service.deactivate(dto()));

      expectForbidden(unknown);
      expect((foreign as ForbiddenException).getError()).toEqual(
        (unknown as ForbiddenException).getError(),
      );
    });

    it('an already inactive user is forbidden: no second revoke, no second event', async () => {
      users = [user({ isActive: false })];

      expectForbidden(await errorOf(service.deactivate(dto())));

      expect(tokenUpdateMany).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('a second call after a successful one is forbidden and emits nothing new', async () => {
      await service.deactivate(dto());
      publish.mockClear();

      expectForbidden(await errorOf(service.deactivate(dto())));

      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('race safety', () => {
    it('is forbidden, revokes nothing and emits nothing when the row changed meanwhile', async () => {
      userUpdateCount = 0;

      expectForbidden(await errorOf(service.deactivate(dto())));

      expect(tokenUpdateMany).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });
  });
});
