import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  InvalidCredentialsException,
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
// Argon2 is real in password.spec.ts; here a cheap fake keeps the suite fast
// and stops it from starving other suites of CPU/memory when run in parallel.
jest.mock('../common/crypto/password', () => ({
  hashPassword: (password: string) => Promise.resolve(`fake:${password}`),
  verifyPassword: (hash: string, password: string) =>
    Promise.resolve(hash === `fake:${password}`),
}));
// The generated client is ESM-only; the service only needs its class shape.
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));

const NOW = new Date('2026-10-12T10:00:00.000Z');
const MINUTE = 60_000;
const PASSWORD = 'correct horse battery';
const USER_ID = '0199b7e0-0000-7000-8000-000000000001';
const TENANT_ID = '0199b7e0-0000-7000-8000-000000000002';

type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';
type TenantStatus =
  'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED';

interface StoredUser {
  id: string;
  tenantId: string | null;
  role: Role;
  passwordHash: string;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  tenant: { status: TenantStatus } | null;
}

// Covers: S3.4
describe('AuthService.login', () => {
  let service: AuthService;
  let jwt: JwtService;
  let passwordHash: string;
  const findUnique = jest.fn();
  const update = jest.fn();
  const refreshTokenCreate = jest.fn();
  const prisma = {
    user: { findUnique, update },
    refreshToken: { create: refreshTokenCreate },
  };

  function user(overrides: Partial<StoredUser> = {}): StoredUser {
    return {
      id: USER_ID,
      tenantId: TENANT_ID,
      role: 'OWNER',
      passwordHash,
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      tenant: { status: 'ACTIVE' },
      ...overrides,
    };
  }

  function login(email = 'ana@acme.test', password = PASSWORD) {
    return service.login({ email, password });
  }

  async function errorOf(promise: Promise<unknown>) {
    return promise.then(
      () => {
        throw new Error('Expected login to fail');
      },
      (error: unknown) => error,
    );
  }

  function expectGeneric(error: unknown) {
    expect(error).toBeInstanceOf(InvalidCredentialsException);
    expect((error as InvalidCredentialsException).getError()).toEqual({
      status: 401,
      code: 'invalid_credentials',
      message: 'Invalid credentials',
    });
  }

  beforeAll(async () => {
    passwordHash = `fake:${PASSWORD}`;
  });

  beforeEach(async () => {
    // Fake only Date: jsonwebtoken and argon2 need real timers/ticks.
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
    update.mockResolvedValue({ failedLoginAttempts: 1 });
    refreshTokenCreate.mockResolvedValue({});

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

  describe('success', () => {
    it('returns a token pair with a lowercase role claim', async () => {
      findUnique.mockResolvedValue(user());

      const pair = await login();

      expect(Object.keys(pair).sort()).toEqual([
        'accessToken',
        'expiresIn',
        'refreshToken',
      ]);
      const claims = jwt.decode<Record<string, unknown>>(pair.accessToken);
      expect(claims.sub).toBe(USER_ID);
      expect(claims.tenantId).toBe(TENANT_ID);
      expect(claims.role).toBe('owner');
      expect(refreshTokenCreate).toHaveBeenCalledTimes(1);
    });

    it('looks the user up by the normalized email', async () => {
      findUnique.mockResolvedValue(user());

      await login('  Ana@ACME.test ');

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'ana@acme.test' } }),
      );
    });

    it('resets the failure counter and the lock', async () => {
      findUnique.mockResolvedValue(user({ failedLoginAttempts: 3 }));

      await login();

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        }),
      );
    });

    it('does not write when there is nothing to reset', async () => {
      findUnique.mockResolvedValue(user());

      await login();

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('generic invalid_credentials', () => {
    it('unknown email', async () => {
      findUnique.mockResolvedValue(null);

      expectGeneric(await errorOf(login('nobody@acme.test')));
      expect(update).not.toHaveBeenCalled();
      expect(refreshTokenCreate).not.toHaveBeenCalled();
    });

    it('wrong password', async () => {
      findUnique.mockResolvedValue(user());

      expectGeneric(await errorOf(login('ana@acme.test', 'wrong password')));
      expect(refreshTokenCreate).not.toHaveBeenCalled();
    });

    it('inactive user, even with the correct password', async () => {
      findUnique.mockResolvedValue(user({ isActive: false }));

      expectGeneric(await errorOf(login()));
      expect(update).not.toHaveBeenCalled();
      expect(refreshTokenCreate).not.toHaveBeenCalled();
    });

    it('user of a deleted tenant', async () => {
      findUnique.mockResolvedValue(user({ tenant: { status: 'DELETED' } }));

      expectGeneric(await errorOf(login()));
      expect(refreshTokenCreate).not.toHaveBeenCalled();
    });
  });

  describe('lockout', () => {
    it('increments the counter atomically on a wrong password', async () => {
      findUnique.mockResolvedValue(user({ failedLoginAttempts: 1 }));
      update.mockResolvedValue({ failedLoginAttempts: 2 });

      expectGeneric(await errorOf(login('ana@acme.test', 'wrong password')));

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: { failedLoginAttempts: { increment: 1 } },
        }),
      );
    });

    it('the 5th consecutive failure locks the account for 15 minutes', async () => {
      findUnique.mockResolvedValue(user({ failedLoginAttempts: 4 }));
      update.mockResolvedValueOnce({ failedLoginAttempts: 5 });

      expectGeneric(await errorOf(login('ana@acme.test', 'wrong password')));

      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: new Date(NOW.getTime() + 15 * MINUTE),
          },
        }),
      );
    });

    it('a locked account is refused even with the correct password', async () => {
      findUnique.mockResolvedValue(
        user({ lockedUntil: new Date(NOW.getTime() + 15 * MINUTE) }),
      );

      expectGeneric(await errorOf(login()));
      expect(refreshTokenCreate).not.toHaveBeenCalled();
    });

    it('attempts during the lock do not count or extend it', async () => {
      findUnique.mockResolvedValue(
        user({ lockedUntil: new Date(NOW.getTime() + 10 * MINUTE) }),
      );

      expectGeneric(await errorOf(login('ana@acme.test', 'wrong password')));
      expectGeneric(await errorOf(login()));
      expect(update).not.toHaveBeenCalled();
    });

    it('the lock lasts exactly 15 minutes', async () => {
      const lockedUntil = new Date(NOW.getTime() + 15 * MINUTE);
      findUnique.mockResolvedValue(user({ lockedUntil }));

      jest.setSystemTime(new Date(lockedUntil.getTime() - 1000));
      expectGeneric(await errorOf(login()));

      jest.setSystemTime(lockedUntil);
      await expect(login()).resolves.toHaveProperty('accessToken');
    });

    it('after the lock expires the counter starts fresh', async () => {
      // The counter was reset to 0 when the lock was set.
      findUnique.mockResolvedValue(
        user({
          failedLoginAttempts: 0,
          lockedUntil: new Date(NOW.getTime() - MINUTE),
        }),
      );
      update.mockResolvedValue({ failedLoginAttempts: 1 });

      expectGeneric(await errorOf(login('ana@acme.test', 'wrong password')));

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { failedLoginAttempts: { increment: 1 } },
        }),
      );
    });
  });

  describe('tenant status', () => {
    it.each(['SUPERVISOR', 'EMPLOYEE'] as const)(
      '%s of a suspended tenant gets tenant_suspended after a correct password',
      async (role) => {
        findUnique.mockResolvedValue(
          user({ role, tenant: { status: 'SUSPENDED' } }),
        );

        const error = await errorOf(login());

        expect(error).toBeInstanceOf(TenantSuspendedException);
        expect((error as TenantSuspendedException).getError()).toEqual(
          expect.objectContaining({ status: 403, code: 'tenant_suspended' }),
        );
        expect(refreshTokenCreate).not.toHaveBeenCalled();
      },
    );

    it.each(['SUPERVISOR', 'EMPLOYEE'] as const)(
      '%s of a cancelled tenant gets tenant_cancelled after a correct password',
      async (role) => {
        findUnique.mockResolvedValue(
          user({ role, tenant: { status: 'CANCELLED' } }),
        );

        const error = await errorOf(login());

        expect(error).toBeInstanceOf(TenantCancelledException);
        expect((error as TenantCancelledException).getError()).toEqual(
          expect.objectContaining({ status: 403, code: 'tenant_cancelled' }),
        );
        expect(refreshTokenCreate).not.toHaveBeenCalled();
      },
    );

    it.each(['SUSPENDED', 'CANCELLED'] as const)(
      'a wrong password on a %s tenant stays invalid_credentials',
      async (status) => {
        findUnique.mockResolvedValue(
          user({ role: 'EMPLOYEE', tenant: { status } }),
        );

        expectGeneric(await errorOf(login('ana@acme.test', 'wrong password')));
      },
    );

    it.each([
      ['OWNER', 'SUSPENDED'],
      ['OWNER', 'CANCELLED'],
      ['ADMIN', 'SUSPENDED'],
      ['ADMIN', 'CANCELLED'],
    ] as const)('%s of a %s tenant can log in', async (role, status) => {
      findUnique.mockResolvedValue(user({ role, tenant: { status } }));

      const pair = await login();

      expect(jwt.decode<{ role: string }>(pair.accessToken).role).toBe(
        role.toLowerCase(),
      );
    });

    it('a past_due tenant does not restrict anyone', async () => {
      findUnique.mockResolvedValue(
        user({ role: 'EMPLOYEE', tenant: { status: 'PAST_DUE' } }),
      );

      await expect(login()).resolves.toHaveProperty('accessToken');
    });

    it('a failed password on a restricted tenant still counts toward the lock', async () => {
      findUnique.mockResolvedValue(
        user({ role: 'EMPLOYEE', tenant: { status: 'SUSPENDED' } }),
      );
      update.mockResolvedValue({ failedLoginAttempts: 2 });

      await errorOf(login('ana@acme.test', 'wrong password'));

      expect(update).toHaveBeenCalledTimes(1);
    });

    it('platform_admin logs in with a null tenant and tenantId', async () => {
      findUnique.mockResolvedValue(
        user({ role: 'PLATFORM_ADMIN', tenantId: null, tenant: null }),
      );

      const pair = await login();

      const claims = jwt.decode<Record<string, unknown>>(pair.accessToken);
      expect(claims.tenantId).toBeNull();
      expect(claims.role).toBe('platform_admin');
    });
  });
});
