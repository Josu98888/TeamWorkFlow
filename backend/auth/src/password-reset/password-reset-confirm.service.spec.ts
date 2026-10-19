import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { hashPassword, hashToken, verifyPassword } from '../common/crypto';
import {
  ForbiddenException,
  InvalidCredentialsException,
  InvalidTokenException,
} from '../common/exceptions/app.exceptions';
import { envs } from '../config';
import { JetStreamService } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetConfirmService } from './password-reset-confirm.service';
import { PasswordResetCreateService } from './password-reset-create.service';
import type { CreatePasswordResetDto } from './dto/password-reset-create.dto';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// The generated client is ESM-only; the services only need its class shape.
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));

// Argon2 hashing is slow under a loaded full run.
jest.setTimeout(30_000);

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const ACTOR_ID = '0199b7e0-0000-7000-8000-000000000001';
const TARGET_ID = '0199b7e0-0000-7000-8000-000000000002';
const OTHER_ID = '0199b7e0-0000-7000-8000-000000000003';
const OLD_PASSWORD = 'old password value';
const NEW_PASSWORD = 'brand new password';
const FUTURE = new Date('2099-01-01T00:00:00.000Z');

type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';
type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  tenantId: string | null;
  role: Role;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

interface StoredToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface StoredReset {
  id: string;
  userId: string;
  tokenHash: string;
  createdById: string;
  expiresAt: Date;
  usedAt: Date | null;
}

interface UserWhere {
  id?: string;
  email?: string;
  tenantId?: string;
  isActive?: boolean;
}

function matches(user: StoredUser, where: UserWhere): boolean {
  return (
    (where.id === undefined || user.id === where.id) &&
    (where.email === undefined || user.email === where.email) &&
    (where.tenantId === undefined || user.tenantId === where.tenantId) &&
    (where.isActive === undefined || user.isActive === where.isActive)
  );
}

// Covers: S5.6
describe('PasswordResetConfirmService.confirm', () => {
  let oldHash: string;
  let service: PasswordResetConfirmService;
  let creator: PasswordResetCreateService;
  let auth: AuthService;
  let tokens: TokenService;
  let users: StoredUser[];
  let refreshTokens: StoredToken[];
  let resets: StoredReset[];
  let tenantStatus: TenantStatus;
  let resetUpdateCount: number | undefined;
  let userUpdateCount: number | undefined;
  const resetFindUnique = jest.fn();
  const resetUpdateMany = jest.fn();
  const userUpdateMany = jest.fn();
  const tokenUpdateMany = jest.fn();
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: userUpdateMany,
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: tokenUpdateMany,
    },
    passwordResetToken: {
      create: jest.fn(),
      findUnique: resetFindUnique,
      updateMany: resetUpdateMany,
    },
    $transaction: jest.fn(),
  };

  beforeAll(async () => {
    oldHash = await hashPassword(OLD_PASSWORD);
  });

  function user(overrides: Partial<StoredUser> = {}): StoredUser {
    return {
      id: TARGET_ID,
      email: 'target@example.com',
      passwordHash: oldHash,
      tenantId: TENANT_A,
      role: 'EMPLOYEE',
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      ...overrides,
    };
  }

  function actorDto(
    role: CreatePasswordResetDto['actor']['role'] = 'admin',
  ): CreatePasswordResetDto {
    return {
      actor: { userId: ACTOR_ID, tenantId: TENANT_A, role },
      userId: TARGET_ID,
    };
  }

  // Mints a real token through the create service.
  async function issue(): Promise<string> {
    return (await creator.create(actorDto())).token;
  }

  function errorOf(promise: Promise<unknown>) {
    return promise.then(
      () => {
        throw new Error('Expected the call to fail');
      },
      (error: unknown) => error,
    );
  }

  function expectInvalidToken(error: unknown) {
    expect(error).toBeInstanceOf(InvalidTokenException);
    expect((error as InvalidTokenException).getError()).toEqual(
      expect.objectContaining({ status: 401, code: 'invalid_token' }),
    );
  }

  const tenantOf = () => ({ status: tenantStatus, plan: 'PRO', features: {} });

  beforeEach(async () => {
    jest.resetAllMocks();
    users = [user()];
    refreshTokens = [];
    resets = [];
    tenantStatus = 'ACTIVE';
    resetUpdateCount = undefined;
    userUpdateCount = undefined;

    prisma.user.findFirst.mockImplementation(
      ({ where }: { where: UserWhere }) =>
        Promise.resolve(users.find((u) => matches(u, where)) ?? null),
    );
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: UserWhere }) => {
        const found = users.find((u) => matches(u, where));
        return Promise.resolve(found ? { ...found, tenant: tenantOf() } : null);
      },
    );
    prisma.user.update.mockImplementation(
      ({ where, data }: { where: UserWhere; data: Partial<StoredUser> }) => {
        const found = users.find((u) => matches(u, where));
        if (found && typeof data.failedLoginAttempts === 'number') {
          Object.assign(found, data);
        }
        return Promise.resolve({ failedLoginAttempts: 0 });
      },
    );
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
        const row = {
          id: `token-${refreshTokens.length + 1}`,
          revokedAt: null,
          ...data,
        };
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

    prisma.passwordResetToken.create.mockImplementation(
      ({ data }: { data: Omit<StoredReset, 'id' | 'usedAt'> }) => {
        resets.push({
          id: `reset-${resets.length + 1}`,
          usedAt: null,
          ...data,
        });
        return Promise.resolve({ expiresAt: data.expiresAt });
      },
    );
    resetFindUnique.mockImplementation(
      ({ where }: { where: { tokenHash: string } }) => {
        const row = resets.find((r) => r.tokenHash === where.tokenHash);
        const owner = users.find((u) => u.id === row?.userId);
        return Promise.resolve(
          row && owner
            ? { ...row, user: { ...owner, tenant: tenantOf() } }
            : null,
        );
      },
    );
    resetUpdateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: {
          id?: string;
          userId?: string;
          usedAt: null;
          expiresAt?: { gt: Date };
        };
        data: { usedAt: Date };
      }) => {
        const hits = resets.filter(
          (r) =>
            (where.id === undefined || r.id === where.id) &&
            (where.userId === undefined || r.userId === where.userId) &&
            r.usedAt === null &&
            (where.expiresAt === undefined ||
              r.expiresAt.getTime() > where.expiresAt.gt.getTime()),
        );
        if (resetUpdateCount === undefined) {
          hits.forEach((r) => (r.usedAt = data.usedAt));
        }
        return Promise.resolve({ count: resetUpdateCount ?? hits.length });
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
        PasswordResetConfirmService,
        PasswordResetCreateService,
        AuthService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: JetStreamService, useValue: { publish: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(PasswordResetConfirmService);
    creator = moduleRef.get(PasswordResetCreateService);
    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(TokenService);
  });

  describe('confirming', () => {
    it('replaces the password hash with an Argon2id hash of the new password', async () => {
      const token = await issue();

      await expect(
        service.confirm({ token, password: NEW_PASSWORD }),
      ).resolves.toEqual({ ok: true });

      expect(users[0].passwordHash).not.toBe(oldHash);
      expect(users[0].passwordHash).not.toContain(NEW_PASSWORD);
      await expect(
        verifyPassword(users[0].passwordHash, NEW_PASSWORD),
      ).resolves.toBe(true);
    });

    it('marks the token as used', async () => {
      const token = await issue();

      await service.confirm({ token, password: NEW_PASSWORD });

      expect(resets[0].usedAt).toBeInstanceOf(Date);
    });

    it('does every write inside one transaction', async () => {
      const token = await issue();
      prisma.$transaction.mockClear();

      await service.confirm({ token, password: NEW_PASSWORD });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(userUpdateMany).toHaveBeenCalledWith({
        where: { id: TARGET_ID, isActive: true },
        data: {
          passwordHash: expect.any(String),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      expect(tokenUpdateMany).toHaveBeenCalledWith({
        where: { userId: TARGET_ID, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('clears the lockout counters', async () => {
      users[0].failedLoginAttempts = 3;
      users[0].lockedUntil = FUTURE;
      const token = await issue();

      await service.confirm({ token, password: NEW_PASSWORD });

      expect(users[0].failedLoginAttempts).toBe(0);
      expect(users[0].lockedUntil).toBeNull();
      await expect(
        auth.login({ email: 'target@example.com', password: NEW_PASSWORD }),
      ).resolves.toHaveProperty('accessToken');
    });

    it('does not touch other users', async () => {
      users.push(user({ id: OTHER_ID, email: 'other@example.com' }));
      const token = await issue();

      await service.confirm({ token, password: NEW_PASSWORD });

      expect(users[1].passwordHash).toBe(oldHash);
    });

    it('also invalidates other unused reset tokens of the user', async () => {
      const token = await issue();
      resets.push({
        id: 'reset-other',
        userId: TARGET_ID,
        tokenHash: 'other-hash',
        createdById: ACTOR_ID,
        expiresAt: FUTURE,
        usedAt: null,
      });

      await service.confirm({ token, password: NEW_PASSWORD });

      expect(resets.every((r) => r.usedAt instanceof Date)).toBe(true);
    });
  });

  describe('sessions and login (real AuthService)', () => {
    function session() {
      return tokens.issueTokenPair({
        id: TARGET_ID,
        tenantId: TENANT_A,
        role: 'EMPLOYEE',
      });
    }

    it('previous refresh tokens are rejected after confirm and revoked in the store', async () => {
      const first = await session();
      const second = await session();
      const token = await issue();
      await expect(
        auth.refresh({ refreshToken: first.refreshToken }),
      ).resolves.toHaveProperty('refreshToken');

      await service.confirm({ token, password: NEW_PASSWORD });

      for (const refreshToken of [first.refreshToken, second.refreshToken]) {
        expectInvalidToken(await errorOf(auth.refresh({ refreshToken })));
        expect(
          refreshTokens.find((t) => t.tokenHash === hashToken(refreshToken))
            ?.revokedAt,
        ).toBeInstanceOf(Date);
      }
    });

    it('revokes only the tokens of the reset user', async () => {
      const other = await tokens.issueTokenPair({
        id: OTHER_ID,
        tenantId: TENANT_A,
        role: 'EMPLOYEE',
      });
      users.push(user({ id: OTHER_ID, email: 'other@example.com' }));
      const token = await issue();

      await service.confirm({ token, password: NEW_PASSWORD });

      await expect(
        auth.refresh({ refreshToken: other.refreshToken }),
      ).resolves.toHaveProperty('refreshToken');
    });

    it('login works with the new password and not with the old one', async () => {
      const token = await issue();
      await service.confirm({ token, password: NEW_PASSWORD });

      await expect(
        auth.login({ email: 'target@example.com', password: NEW_PASSWORD }),
      ).resolves.toHaveProperty('accessToken');
      expect(
        await errorOf(
          auth.login({ email: 'target@example.com', password: OLD_PASSWORD }),
        ),
      ).toBeInstanceOf(InvalidCredentialsException);
    });
  });

  describe('invalid tokens', () => {
    it('an unknown token is invalid_token and changes nothing', async () => {
      expectInvalidToken(
        await errorOf(
          service.confirm({ token: 'nope', password: NEW_PASSWORD }),
        ),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(users[0].passwordHash).toBe(oldHash);
    });

    it('a used token is invalid_token: the second confirm fails and keeps the first password', async () => {
      const token = await issue();
      await service.confirm({ token, password: NEW_PASSWORD });
      const firstHash = users[0].passwordHash;

      expectInvalidToken(
        await errorOf(service.confirm({ token, password: 'another password' })),
      );

      expect(users[0].passwordHash).toBe(firstHash);
    });

    it('an expired token is invalid_token', async () => {
      const token = await issue();
      resets[0].expiresAt = new Date(Date.now() - 1000);

      expectInvalidToken(
        await errorOf(service.confirm({ token, password: NEW_PASSWORD })),
      );

      expect(users[0].passwordHash).toBe(oldHash);
      expect(resets[0].usedAt).toBeNull();
    });

    it('a token superseded by a newer reset is invalid_token; the newer one works', async () => {
      const first = await issue();
      const second = await issue();

      expectInvalidToken(
        await errorOf(
          service.confirm({ token: first, password: NEW_PASSWORD }),
        ),
      );
      await expect(
        service.confirm({ token: second, password: NEW_PASSWORD }),
      ).resolves.toEqual({ ok: true });
    });

    it('a token of a deactivated user is invalid_token', async () => {
      const token = await issue();
      users[0].isActive = false;

      expectInvalidToken(
        await errorOf(service.confirm({ token, password: NEW_PASSWORD })),
      );

      expect(users[0].passwordHash).toBe(oldHash);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1); // only the create
    });

    it('a token of a purged tenant is invalid_token', async () => {
      const token = await issue();
      tenantStatus = 'DELETED';

      expectInvalidToken(
        await errorOf(service.confirm({ token, password: NEW_PASSWORD })),
      );
    });

    it('a suspended tenant does not block the reset of its user', async () => {
      const token = await issue();
      tenantStatus = 'SUSPENDED';

      await expect(
        service.confirm({ token, password: NEW_PASSWORD }),
      ).resolves.toEqual({ ok: true });
    });
  });

  describe('race safety', () => {
    it('is invalid_token and changes nothing when another confirm consumed the token first', async () => {
      const token = await issue();
      resetUpdateCount = 0;

      expectInvalidToken(
        await errorOf(service.confirm({ token, password: NEW_PASSWORD })),
      );

      expect(userUpdateMany).not.toHaveBeenCalled();
      expect(tokenUpdateMany).not.toHaveBeenCalled();
    });

    it('is invalid_token and revokes nothing when the user was deactivated meanwhile', async () => {
      const token = await issue();
      userUpdateCount = 0;

      expectInvalidToken(
        await errorOf(service.confirm({ token, password: NEW_PASSWORD })),
      );

      expect(tokenUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('role table and tenant isolation (through create)', () => {
    it('an admin creating a reset for an admin is forbidden: no token exists to confirm', async () => {
      users[0].role = 'ADMIN';

      const error = await errorOf(creator.create(actorDto('admin')));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(resets).toHaveLength(0);
    });

    it('an owner target is forbidden for everyone', async () => {
      users[0].role = 'OWNER';

      for (const role of ['owner', 'admin'] as const) {
        expect(await errorOf(creator.create(actorDto(role)))).toBeInstanceOf(
          ForbiddenException,
        );
      }
      expect(resets).toHaveLength(0);
    });

    it('an actor of tenant A cannot create a reset for a user of tenant B, so tenant B is never reachable', async () => {
      users[0].tenantId = TENANT_B;

      const error = await errorOf(creator.create(actorDto('owner')));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(resets).toHaveLength(0);
      expect(users[0].passwordHash).toBe(oldHash);
    });

    it('confirm takes the user from the stored token, never from the payload', async () => {
      users.push(user({ id: OTHER_ID, email: 'other@example.com' }));
      const token = await issue();

      await service.confirm({ token, password: NEW_PASSWORD });

      expect(users[0].passwordHash).not.toBe(oldHash);
      expect(users[1].passwordHash).toBe(oldHash);
    });
  });
});
