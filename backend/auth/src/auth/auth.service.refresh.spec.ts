import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hashToken } from '../common/crypto';
import {
  InvalidTokenException,
  TenantCancelledException,
  TenantSuspendedException,
} from '../common/exceptions/app.exceptions';
import { envs } from '../config';
import { JetStreamService } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// The generated client is ESM-only; the service only needs its class shape.
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));

const NOW = new Date('2026-10-12T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const RAW = 'raw-refresh-token';
const TOKEN_ID = '0199b7e0-0000-7000-8000-0000000000aa';
const USER_ID = '0199b7e0-0000-7000-8000-000000000001';
const TENANT_ID = '0199b7e0-0000-7000-8000-000000000002';

type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';
type TenantStatus =
  'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED';

interface StoredToken {
  id: string;
  revokedAt: Date | null;
  expiresAt: Date;
  user: {
    id: string;
    tenantId: string | null;
    role: Role;
    isActive: boolean;
    tenant: { status: TenantStatus } | null;
  };
}

// Covers: S3.5
describe('AuthService.refresh', () => {
  let service: AuthService;
  let jwt: JwtService;
  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const create = jest.fn();
  const tx = { refreshToken: { updateMany, create } };
  const prisma = {
    refreshToken: { findUnique },
    $transaction: jest.fn(),
  };

  function stored(
    overrides: Partial<Omit<StoredToken, 'user'>> & {
      user?: Partial<StoredToken['user']>;
    } = {},
  ): StoredToken {
    const { user, ...rest } = overrides;
    return {
      id: TOKEN_ID,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + DAY),
      ...rest,
      user: {
        id: USER_ID,
        tenantId: TENANT_ID,
        role: 'OWNER',
        isActive: true,
        tenant: { status: 'ACTIVE' },
        ...user,
      },
    };
  }

  function refresh(refreshToken = RAW) {
    return service.refresh({ refreshToken });
  }

  function errorOf(promise: Promise<unknown>) {
    return promise.then(
      () => {
        throw new Error('Expected refresh to fail');
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

  beforeEach(async () => {
    // Fake only Date: jsonwebtoken needs real timers/ticks.
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    jest.resetAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
    create.mockResolvedValue({});
    prisma.$transaction.mockImplementation(
      (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: envs.jwtSecret,
          signOptions: { algorithm: 'HS256' },
        }),
      ],
      providers: [
        AuthService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: JetStreamService, useValue: { publish: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('rotation', () => {
    it('revokes the old token and issues a new pair', async () => {
      findUnique.mockResolvedValue(stored());

      const pair = await refresh();

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hashToken(RAW) } }),
      );
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: TOKEN_ID, revokedAt: null },
        data: { revokedAt: NOW },
      });
      expect(Object.keys(pair).sort()).toEqual([
        'accessToken',
        'expiresIn',
        'refreshToken',
      ]);
      expect(pair.refreshToken).not.toBe(RAW);
      const claims = jwt.decode<Record<string, unknown>>(pair.accessToken);
      expect(claims.sub).toBe(USER_ID);
      expect(claims.tenantId).toBe(TENANT_ID);
      expect(claims.role).toBe('owner');
    });

    it('stores only the hash of the new refresh token, in the same transaction', async () => {
      findUnique.mockResolvedValue(stored());

      const pair = await refresh();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
      const { data } = create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.userId).toBe(USER_ID);
      expect(data.tokenHash).toBe(hashToken(pair.refreshToken));
      expect(JSON.stringify(data)).not.toContain(pair.refreshToken);
    });

    it('reusing the old token fails with invalid_token', async () => {
      findUnique.mockResolvedValue(stored());
      await refresh();

      // After rotation the stored row is revoked.
      findUnique.mockResolvedValue(stored({ revokedAt: NOW }));
      create.mockClear();

      expectInvalidToken(await errorOf(refresh()));
      expect(create).not.toHaveBeenCalled();
    });

    it('a concurrent rotation that already revoked the token gives invalid_token and issues nothing', async () => {
      findUnique.mockResolvedValue(stored());
      updateMany.mockResolvedValue({ count: 0 });

      expectInvalidToken(await errorOf(refresh()));
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('invalid_token', () => {
    it('unknown token', async () => {
      findUnique.mockResolvedValue(null);

      expectInvalidToken(await errorOf(refresh('nope')));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('revoked token', async () => {
      findUnique.mockResolvedValue(stored({ revokedAt: new Date(0) }));

      expectInvalidToken(await errorOf(refresh()));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('expired token (expiresAt <= now)', async () => {
      findUnique.mockResolvedValue(stored({ expiresAt: NOW }));

      expectInvalidToken(await errorOf(refresh()));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('token one millisecond before expiry is still valid', async () => {
      findUnique.mockResolvedValue(
        stored({ expiresAt: new Date(NOW.getTime() + 1) }),
      );

      await expect(refresh()).resolves.toHaveProperty('accessToken');
    });

    it('deactivated user', async () => {
      findUnique.mockResolvedValue(stored({ user: { isActive: false } }));

      expectInvalidToken(await errorOf(refresh()));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('user of a deleted tenant', async () => {
      findUnique.mockResolvedValue(
        stored({ user: { tenant: { status: 'DELETED' } } }),
      );

      expectInvalidToken(await errorOf(refresh()));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('tenant status', () => {
    it.each(['SUPERVISOR', 'EMPLOYEE'] as const)(
      '%s of a suspended tenant gets tenant_suspended and nothing is rotated',
      async (role) => {
        findUnique.mockResolvedValue(
          stored({ user: { role, tenant: { status: 'SUSPENDED' } } }),
        );

        const error = await errorOf(refresh());

        expect(error).toBeInstanceOf(TenantSuspendedException);
        expect((error as TenantSuspendedException).getError()).toEqual(
          expect.objectContaining({ status: 403, code: 'tenant_suspended' }),
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it.each(['SUPERVISOR', 'EMPLOYEE'] as const)(
      '%s of a cancelled tenant gets tenant_cancelled and nothing is rotated',
      async (role) => {
        findUnique.mockResolvedValue(
          stored({ user: { role, tenant: { status: 'CANCELLED' } } }),
        );

        const error = await errorOf(refresh());

        expect(error).toBeInstanceOf(TenantCancelledException);
        expect((error as TenantCancelledException).getError()).toEqual(
          expect.objectContaining({ status: 403, code: 'tenant_cancelled' }),
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('a revoked token of a suspended tenant is still invalid_token', async () => {
      findUnique.mockResolvedValue(
        stored({
          revokedAt: new Date(0),
          user: { role: 'EMPLOYEE', tenant: { status: 'SUSPENDED' } },
        }),
      );

      expectInvalidToken(await errorOf(refresh()));
    });

    it.each([
      ['OWNER', 'SUSPENDED'],
      ['OWNER', 'CANCELLED'],
      ['ADMIN', 'SUSPENDED'],
      ['ADMIN', 'CANCELLED'],
    ] as const)('%s of a %s tenant can refresh', async (role, status) => {
      findUnique.mockResolvedValue(
        stored({ user: { role, tenant: { status } } }),
      );

      const pair = await refresh();

      expect(jwt.decode<{ role: string }>(pair.accessToken).role).toBe(
        role.toLowerCase(),
      );
    });

    it('a past_due tenant does not restrict anyone', async () => {
      findUnique.mockResolvedValue(
        stored({ user: { role: 'EMPLOYEE', tenant: { status: 'PAST_DUE' } } }),
      );

      await expect(refresh()).resolves.toHaveProperty('accessToken');
    });

    it('platform_admin refreshes with a null tenant', async () => {
      findUnique.mockResolvedValue(
        stored({
          user: { role: 'PLATFORM_ADMIN', tenantId: null, tenant: null },
        }),
      );

      const pair = await refresh();

      const claims = jwt.decode<Record<string, unknown>>(pair.accessToken);
      expect(claims.tenantId).toBeNull();
      expect(claims.role).toBe('platform_admin');
    });
  });
});
