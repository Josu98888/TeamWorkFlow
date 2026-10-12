import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
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
const USER_ID = '0199b7e0-0000-7000-8000-000000000001';
const TENANT_ID = '0199b7e0-0000-7000-8000-000000000002';
const FEATURES = { tasks: true, alerts: true, tower: false };

type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';
type TenantStatus =
  'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED';

interface StoredUser {
  id: string;
  tenantId: string | null;
  role: Role;
  isActive: boolean;
  siteIds: string[];
  tenant: {
    status: TenantStatus;
    plan: 'BASIC' | 'PRO' | null;
    features: Record<string, boolean> | null;
  } | null;
}

function b64(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// Covers: S3.7
describe('AuthService.verify', () => {
  let service: AuthService;
  let jwt: JwtService;
  const findUnique = jest.fn();
  const prisma = { user: { findUnique } };

  function user(overrides: Partial<StoredUser> = {}): StoredUser {
    return {
      id: USER_ID,
      tenantId: TENANT_ID,
      role: 'OWNER',
      isActive: true,
      siteIds: [],
      tenant: { status: 'ACTIVE', plan: 'PRO', features: FEATURES },
      ...overrides,
    };
  }

  function tenantWith(
    status: TenantStatus,
    extra: Partial<NonNullable<StoredUser['tenant']>> = {},
  ): StoredUser['tenant'] {
    return { status, plan: 'PRO', features: FEATURES, ...extra };
  }

  function accessToken(
    claims: { tenantId?: string | null; role?: string } = {},
    options: { subject?: string; expiresIn?: number } = {},
  ) {
    return jwt.signAsync(
      {
        tenantId: claims.tenantId === undefined ? TENANT_ID : claims.tenantId,
        role: claims.role ?? 'owner',
      },
      {
        subject: options.subject ?? USER_ID,
        jwtid: 'jti-1',
        expiresIn: options.expiresIn ?? 900,
      },
    );
  }

  async function verify(accessTokenValue?: string) {
    return service.verify({
      accessToken: accessTokenValue ?? (await accessToken()),
    });
  }

  function errorOf(promise: Promise<unknown>) {
    return promise.then(
      () => {
        throw new Error('Expected verify to fail');
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
    findUnique.mockResolvedValue(user());

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

  describe('result', () => {
    it('returns the actor of an owner with wire values', async () => {
      await expect(verify()).resolves.toEqual({
        userId: USER_ID,
        tenantId: TENANT_ID,
        role: 'owner',
        tenantStatus: 'active',
        plan: 'pro',
        features: FEATURES,
      });
    });

    it('looks the user up by the token subject', async () => {
      await verify();

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: USER_ID } }),
      );
    });

    it('a supervisor gets siteIds', async () => {
      findUnique.mockResolvedValue(
        user({ role: 'SUPERVISOR', siteIds: ['site-a', 'site-b'] }),
      );

      const actor = await verify(await accessToken({ role: 'supervisor' }));

      expect(actor.role).toBe('supervisor');
      expect(actor.siteIds).toEqual(['site-a', 'site-b']);
    });

    it.each(['OWNER', 'ADMIN', 'EMPLOYEE'] as const)(
      '%s has no siteIds key',
      async (role) => {
        findUnique.mockResolvedValue(user({ role, siteIds: ['leftover'] }));

        const actor = await verify(
          await accessToken({ role: role.toLowerCase() }),
        );

        expect(actor).not.toHaveProperty('siteIds');
        expect(actor.role).toBe(role.toLowerCase());
      },
    );

    it('platform_admin gets null tenantId, tenantStatus, plan and features', async () => {
      findUnique.mockResolvedValue(
        user({ role: 'PLATFORM_ADMIN', tenantId: null, tenant: null }),
      );

      const actor = await verify(
        await accessToken({ role: 'platform_admin', tenantId: null }),
      );

      expect(actor).toEqual({
        userId: USER_ID,
        tenantId: null,
        role: 'platform_admin',
        tenantStatus: null,
        plan: null,
        features: null,
      });
      expect(actor).not.toHaveProperty('siteIds');
    });

    it('plan and features are null until the first billing event', async () => {
      findUnique.mockResolvedValue(
        user({ tenant: tenantWith('ACTIVE', { plan: null, features: null }) }),
      );

      const actor = await verify();

      expect(actor.plan).toBeNull();
      expect(actor.features).toBeNull();
      expect(actor.tenantStatus).toBe('active');
    });

    it.each([
      ['BASIC', 'basic'],
      ['PRO', 'pro'],
    ] as const)('maps plan %s to %s', async (plan, wire) => {
      findUnique.mockResolvedValue(
        user({ tenant: tenantWith('ACTIVE', { plan }) }),
      );

      expect((await verify()).plan).toBe(wire);
    });

    it('never exposes Prisma enum values', async () => {
      findUnique.mockResolvedValue(
        user({ role: 'SUPERVISOR', tenant: tenantWith('PAST_DUE') }),
      );

      const json = JSON.stringify(await verify());

      expect(json).not.toMatch(/SUPERVISOR|PAST_DUE|"PRO"/);
      expect(json).toContain('past_due');
    });
  });

  describe('tenant status', () => {
    it.each([
      ['OWNER', 'SUSPENDED', 'suspended'],
      ['OWNER', 'CANCELLED', 'cancelled'],
      ['ADMIN', 'SUSPENDED', 'suspended'],
      ['ADMIN', 'CANCELLED', 'cancelled'],
    ] as const)(
      '%s of a %s tenant passes with tenantStatus %s',
      async (role, status, wire) => {
        findUnique.mockResolvedValue(
          user({ role, tenant: tenantWith(status) }),
        );

        const actor = await verify(
          await accessToken({ role: role.toLowerCase() }),
        );

        expect(actor.tenantStatus).toBe(wire);
      },
    );

    it.each(['SUPERVISOR', 'EMPLOYEE'] as const)(
      '%s of a suspended tenant gets tenant_suspended',
      async (role) => {
        findUnique.mockResolvedValue(
          user({ role, tenant: tenantWith('SUSPENDED') }),
        );

        const error = await errorOf(
          verify(await accessToken({ role: role.toLowerCase() })),
        );

        expect(error).toBeInstanceOf(TenantSuspendedException);
        expect((error as TenantSuspendedException).getError()).toEqual(
          expect.objectContaining({ status: 403, code: 'tenant_suspended' }),
        );
      },
    );

    it.each(['SUPERVISOR', 'EMPLOYEE'] as const)(
      '%s of a cancelled tenant gets tenant_cancelled',
      async (role) => {
        findUnique.mockResolvedValue(
          user({ role, tenant: tenantWith('CANCELLED') }),
        );

        const error = await errorOf(
          verify(await accessToken({ role: role.toLowerCase() })),
        );

        expect(error).toBeInstanceOf(TenantCancelledException);
        expect((error as TenantCancelledException).getError()).toEqual(
          expect.objectContaining({ status: 403, code: 'tenant_cancelled' }),
        );
      },
    );

    it('a past_due tenant restricts nobody', async () => {
      findUnique.mockResolvedValue(
        user({ role: 'EMPLOYEE', tenant: tenantWith('PAST_DUE') }),
      );

      const actor = await verify(await accessToken({ role: 'employee' }));

      expect(actor.tenantStatus).toBe('past_due');
    });
  });

  describe('invalid_token', () => {
    it('unknown user', async () => {
      findUnique.mockResolvedValue(null);

      expectInvalidToken(await errorOf(verify()));
    });

    it('deactivated user', async () => {
      findUnique.mockResolvedValue(user({ isActive: false }));

      expectInvalidToken(await errorOf(verify()));
    });

    it('deleted tenant', async () => {
      findUnique.mockResolvedValue(user({ tenant: tenantWith('DELETED') }));

      expectInvalidToken(await errorOf(verify()));
    });

    it('expired token', async () => {
      const token = await accessToken({}, { expiresIn: 60 });

      jest.setSystemTime(new Date(NOW.getTime() + 61_000));

      expectInvalidToken(await errorOf(verify(token)));
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('token signed with another secret', async () => {
      const forged = await new JwtService({
        secret: 'y'.repeat(40),
      }).signAsync(
        { tenantId: TENANT_ID, role: 'owner' },
        { subject: USER_ID, expiresIn: 900 },
      );

      expectInvalidToken(await errorOf(verify(forged)));
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('unsigned token with alg none', async () => {
      const iat = Math.floor(NOW.getTime() / 1000);
      const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
        sub: USER_ID,
        tenantId: TENANT_ID,
        role: 'owner',
        iat,
        exp: iat + 900,
      })}.`;

      expectInvalidToken(await errorOf(verify(unsigned)));
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('token signed with another algorithm (HS512)', async () => {
      const other = await jwt.signAsync(
        { tenantId: TENANT_ID, role: 'owner' },
        { subject: USER_ID, expiresIn: 900, algorithm: 'HS512' },
      );

      expectInvalidToken(await errorOf(verify(other)));
    });

    it.each(['not-a-jwt', 'a.b.c', ' '])(
      'malformed token %p',
      async (value) => {
        expectInvalidToken(await errorOf(verify(value)));
        expect(findUnique).not.toHaveBeenCalled();
      },
    );

    it('token without a role claim or with an unknown role', async () => {
      const noRole = await jwt.signAsync(
        { tenantId: TENANT_ID },
        { subject: USER_ID, expiresIn: 900 },
      );

      expectInvalidToken(await errorOf(verify(noRole)));
      expectInvalidToken(
        await errorOf(verify(await accessToken({ role: 'OWNER' }))),
      );
    });

    it('token without a subject', async () => {
      const noSub = await jwt.signAsync(
        { tenantId: TENANT_ID, role: 'owner' },
        { expiresIn: 900 },
      );

      expectInvalidToken(await errorOf(verify(noSub)));
    });

    it('token whose tenantId differs from the stored one', async () => {
      const token = await accessToken({ tenantId: 'another-tenant' });

      expectInvalidToken(await errorOf(verify(token)));
    });

    it('token with a tenantId for a platform_admin (null tenant in the database)', async () => {
      findUnique.mockResolvedValue(
        user({ role: 'PLATFORM_ADMIN', tenantId: null, tenant: null }),
      );

      expectInvalidToken(
        await errorOf(verify(await accessToken({ role: 'platform_admin' }))),
      );
    });
  });

  describe('stale claims', () => {
    it('returns the role stored in the database, not the one in the token', async () => {
      findUnique.mockResolvedValue(user({ role: 'EMPLOYEE' }));

      const actor = await verify(await accessToken({ role: 'admin' }));

      expect(actor.role).toBe('employee');
    });

    it('applies the tenant rule to the stored role, not the claimed one', async () => {
      findUnique.mockResolvedValue(
        user({ role: 'EMPLOYEE', tenant: tenantWith('SUSPENDED') }),
      );

      const error = await errorOf(verify(await accessToken({ role: 'owner' })));

      expect(error).toBeInstanceOf(TenantSuspendedException);
    });
  });
});
