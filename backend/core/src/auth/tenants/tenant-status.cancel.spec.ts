import { Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';
import type { TokenPair } from '../token.service';
import { hashPassword, hashToken } from '../crypto';
import {
  InvalidTokenException,
  TenantCancelledException,
} from '../../common/exceptions/app.exceptions';
import { envs } from '../../config';
import { AUTH_EVENTS, subjectMatches } from '../events/auth.events';
import { ConsumedEventProcessor } from '../events/consumed-event.processor';
import { JetStreamService } from '../events/jetstream.service';
import type { ConsumedMessage } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantStatusBillingHandlers } from './tenant-status.billing.handlers';

jest.mock('../../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

// Real Argon2 hashing is slow when the whole suite runs in parallel.
jest.setTimeout(30_000);

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const AT = '2026-10-13T10:00:00.000Z';
const EARLIER = new Date('2026-10-01T00:00:00.000Z');
const FUTURE = new Date('2027-01-01T00:00:00.000Z');
const PASSWORD = 'correct horse battery';

type Status = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED';
type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';
type BillingEvent =
  | 'payment_overdue'
  | 'subscription_expired'
  | 'payment_received'
  | 'subscription_cancelled'
  | 'subscription_reactivated';

interface StoredTenant {
  id: string;
  status: Status;
  pastDueSince: Date | null;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
}

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

interface TokenWhere {
  id?: string;
  revokedAt: null;
  user?: { tenantId: string; role: { in: Role[] } };
}

function tenant(id: string, status: Status): StoredTenant {
  return {
    id,
    status,
    pastDueSince: status === 'PAST_DUE' ? EARLIER : null,
    suspendedAt: status === 'SUSPENDED' ? EARLIER : null,
    cancelledAt: status === 'CANCELLED' ? EARLIER : null,
  };
}

// Covers: S7.2
describe('subscription_cancelled and subscription_reactivated', () => {
  let passwordHash: string;
  let tenants: StoredTenant[];
  let users: StoredUser[];
  let refreshTokens: StoredToken[];
  let processed: Set<string>;
  let nextEventId: number;
  let tenantUpdateCount: number | undefined;
  let auth: AuthService;
  let tokens: TokenService;
  let handlers: {
    filter: string;
    run: (m: ConsumedMessage) => Promise<void>;
  }[];
  const publish = jest.fn();
  const prisma = {
    tenant: { findUnique: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    processedEvent: { createMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  function eventId() {
    return `0199b7e0-0000-7000-8000-${String(nextEventId++).padStart(12, '0')}`;
  }

  function deliver(
    event: BillingEvent,
    options: {
      tenantId?: string;
      payloadTenantId?: string;
      eventId?: string;
    } = {},
  ) {
    const tenantId = options.tenantId ?? TENANT_A;
    const subject = `t.${tenantId}.billing.${event}`;
    const handler = handlers.find(({ filter }) =>
      subjectMatches(filter, subject),
    );
    if (!handler) throw new Error(`No handler for ${subject}`);
    return handler.run({
      subject,
      tenantId,
      payload: {
        eventId: options.eventId ?? eventId(),
        tenantId: options.payloadTenantId ?? tenantId,
        occurredAt: AT,
      },
    });
  }

  function user(id: string, role: Role, tenantId = TENANT_A): StoredUser {
    return {
      id,
      email: `${id}@example.com`,
      passwordHash,
      tenantId,
      role,
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      siteIds: [],
    };
  }

  const statusOf = (id = TENANT_A) => tenants.find((t) => t.id === id)?.status;
  const revokedOf = (userId: string) =>
    refreshTokens.find((t) => t.userId === userId)?.revokedAt;

  function errorOf(promise: Promise<unknown>) {
    return promise.then(
      () => {
        throw new Error('Expected the call to fail');
      },
      (error: unknown) => error,
    );
  }

  const tenantView = (id: string | null) => {
    const found = tenants.find((t) => t.id === id);
    return found ? { status: found.status, plan: null, features: null } : null;
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    tenants = [tenant(TENANT_A, 'ACTIVE')];
    users = [
      user('owner', 'OWNER'),
      user('admin', 'ADMIN'),
      user('supervisor', 'SUPERVISOR'),
      user('employee', 'EMPLOYEE'),
    ];
    refreshTokens = [];
    processed = new Set();
    nextEventId = 1;
    tenantUpdateCount = undefined;
    handlers = [];

    prisma.tenant.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        const found = tenants.find((t) => t.id === where.id);
        return Promise.resolve(found ? { status: found.status } : null);
      },
    );
    prisma.tenant.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id: string; status: Status };
        data: Partial<StoredTenant>;
      }) => {
        const hits = tenants.filter(
          (t) => t.id === where.id && t.status === where.status,
        );
        if (tenantUpdateCount === undefined) {
          hits.forEach((t) => Object.assign(t, data));
        }
        return Promise.resolve({ count: tenantUpdateCount ?? hits.length });
      },
    );
    // One in-memory store behind the handler and the real AuthService.
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; email?: string } }) => {
        const found = users.find(
          (u) =>
            (where.id === undefined || u.id === where.id) &&
            (where.email === undefined || u.email === where.email),
        );
        return Promise.resolve(
          found ? { ...found, tenant: tenantView(found.tenantId) } : null,
        );
      },
    );
    prisma.user.update.mockResolvedValue({ failedLoginAttempts: 0 });
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
            ? {
                ...row,
                user: { ...owner, tenant: tenantView(owner.tenantId) },
              }
            : null,
        );
      },
    );
    prisma.refreshToken.updateMany.mockImplementation(
      ({ where, data }: { where: TokenWhere; data: { revokedAt: Date } }) => {
        const hits = refreshTokens.filter((t) => {
          if (t.revokedAt !== null) return false;
          if (where.id !== undefined && t.id !== where.id) return false;
          if (where.user) {
            const owner = users.find((u) => u.id === t.userId);
            return (
              owner?.tenantId === where.user.tenantId &&
              where.user.role.in.includes(owner.role)
            );
          }
          return true;
        });
        hits.forEach((t) => (t.revokedAt = data.revokedAt));
        return Promise.resolve({ count: hits.length });
      },
    );
    prisma.processedEvent.createMany.mockImplementation(
      ({ data }: { data: { eventId: string }[] }) => {
        const fresh = data.filter((row) => !processed.has(row.eventId));
        fresh.forEach((row) => processed.add(row.eventId));
        return Promise.resolve({ count: fresh.length });
      },
    );
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => {
        const snapshot = {
          tenants: tenants.map((t) => ({ ...t })),
          refreshTokens: refreshTokens.map((t) => ({ ...t })),
          processed: new Set(processed),
        };
        try {
          return await callback(prisma);
        } catch (error) {
          ({ tenants, refreshTokens, processed } = snapshot);
          throw error;
        }
      },
    );
    publish.mockResolvedValue(undefined);

    const jetstream = {
      registerHandler: (
        filter: string,
        run: (m: ConsumedMessage) => Promise<void>,
      ) => handlers.push({ filter, run }),
      publish,
    };
    const processor = new ConsumedEventProcessor(
      prisma as never,
      jetstream as never,
    );
    new TenantStatusBillingHandlers(
      processor,
      jetstream as never,
    ).onModuleInit();

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
        { provide: JetStreamService, useValue: { publish } },
      ],
    }).compile();
    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(TokenService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('subscription_cancelled', () => {
    it.each(['ACTIVE', 'PAST_DUE', 'SUSPENDED'] as const)(
      '%s -> cancelled, sets cancelledAt, emits tenant_cancelled',
      async (from) => {
        tenants = [tenant(TENANT_A, from)];

        await deliver('subscription_cancelled');

        expect(statusOf()).toBe('CANCELLED');
        expect(tenants[0].cancelledAt).toEqual(new Date(AT));
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith(
          TENANT_A,
          AUTH_EVENTS.tenantCancelled,
          { tenantId: TENANT_A, cancelledAt: AT },
        );
      },
    );

    it('revokes supervisor and employee refresh tokens of that tenant only', async () => {
      const alreadyRevoked = new Date('2026-10-02T00:00:00.000Z');
      tenants = [tenant(TENANT_A, 'ACTIVE'), tenant(TENANT_B, 'ACTIVE')];
      users.push(user('other-employee', 'EMPLOYEE', TENANT_B));
      for (const u of users) await tokens.issueTokenPair(u);
      refreshTokens.push({
        id: 'old',
        userId: 'employee',
        tokenHash: 'old',
        expiresAt: FUTURE,
        revokedAt: alreadyRevoked,
      });

      await deliver('subscription_cancelled');

      expect(revokedOf('supervisor')).toBeInstanceOf(Date);
      expect(revokedOf('employee')).toBeInstanceOf(Date);
      expect(refreshTokens.find((t) => t.id === 'old')?.revokedAt).toBe(
        alreadyRevoked,
      );
      expect(revokedOf('owner')).toBeNull();
      expect(revokedOf('admin')).toBeNull();
      expect(revokedOf('other-employee')).toBeNull();
    });

    it.each(['CANCELLED', 'DELETED'] as const)(
      'is a no-op while %s: nothing written, nothing emitted',
      async (status) => {
        tenants = [tenant(TENANT_A, status)];
        const before = { ...tenants[0] };
        await tokens.issueTokenPair(users[3]);

        await deliver('subscription_cancelled');

        expect(tenants[0]).toEqual(before);
        expect(revokedOf('employee')).toBeNull();
        expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
        expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      },
    );

    it('a duplicate eventId is a no-op: one write and one emitted event', async () => {
      const id = eventId();

      await deliver('subscription_cancelled', { eventId: id });
      await deliver('subscription_cancelled', { eventId: id });

      expect(prisma.tenant.updateMany).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledTimes(1);
    });

    it('a subject tenant that differs from the payload tenant changes nothing', async () => {
      tenants = [tenant(TENANT_A, 'ACTIVE'), tenant(TENANT_B, 'ACTIVE')];

      await deliver('subscription_cancelled', {
        tenantId: TENANT_A,
        payloadTenantId: TENANT_B,
      });

      expect(tenants.map((t) => t.status)).toEqual(['ACTIVE', 'ACTIVE']);
      expect(processed.size).toBe(0);
      expect(publish).not.toHaveBeenCalled();
    });

    it('a concurrent status change rejects (redelivery), rolls back and emits nothing', async () => {
      await tokens.issueTokenPair(users[3]);
      tenantUpdateCount = 0;

      await expect(deliver('subscription_cancelled')).rejects.toThrow(
        'Tenant status changed concurrently',
      );

      expect(processed.size).toBe(0);
      expect(revokedOf('employee')).toBeNull();
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('subscription_reactivated', () => {
    it('cancelled -> active, clears every date, emits tenant_reactivated', async () => {
      tenants = [
        {
          ...tenant(TENANT_A, 'CANCELLED'),
          pastDueSince: EARLIER,
          suspendedAt: EARLIER,
        },
      ];

      await deliver('subscription_reactivated');

      expect(statusOf()).toBe('ACTIVE');
      expect(tenants[0].pastDueSince).toBeNull();
      expect(tenants[0].suspendedAt).toBeNull();
      expect(tenants[0].cancelledAt).toBeNull();
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(
        TENANT_A,
        AUTH_EVENTS.tenantReactivated,
        { tenantId: TENANT_A },
      );
    });

    it('does not un-revoke the sessions revoked by the cancellation', async () => {
      await tokens.issueTokenPair(users[3]);
      await deliver('subscription_cancelled');
      const revokedAt = revokedOf('employee');

      await deliver('subscription_reactivated');

      expect(revokedOf('employee')).toBe(revokedAt);
    });

    it.each(['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'DELETED'] as const)(
      'is a no-op while %s: nothing written, nothing emitted',
      async (status) => {
        tenants = [tenant(TENANT_A, status)];
        const before = { ...tenants[0] };

        await deliver('subscription_reactivated');

        expect(tenants[0]).toEqual(before);
        expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      },
    );

    it('a duplicate eventId is a no-op and does not undo a later cancellation', async () => {
      tenants = [tenant(TENANT_A, 'CANCELLED')];
      const id = eventId();
      await deliver('subscription_reactivated', { eventId: id });
      await deliver('subscription_cancelled');
      publish.mockClear();

      await deliver('subscription_reactivated', { eventId: id });

      expect(statusOf()).toBe('CANCELLED');
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('payment events while cancelled', () => {
    it.each([
      'payment_received',
      'payment_overdue',
      'subscription_expired',
    ] as const)('%s does not change a cancelled tenant', async (event) => {
      tenants = [tenant(TENANT_A, 'CANCELLED')];
      const before = { ...tenants[0] };

      await deliver(event);

      expect(tenants[0]).toEqual(before);
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('access of a cancelled tenant (real AuthService)', () => {
    const SESSION_USERS = ['owner', 'admin', 'supervisor', 'employee'] as const;
    let sessions: Record<string, TokenPair>;

    beforeEach(async () => {
      sessions = {};
      for (const id of SESSION_USERS) {
        const found = users.find((u) => u.id === id)!;
        sessions[id] = await tokens.issueTokenPair(found);
      }
    });

    const emailOf = (id: string) => `${id}@example.com`;

    it('works for everybody before the cancellation (control)', async () => {
      for (const id of SESSION_USERS) {
        await expect(
          auth.verify({ accessToken: sessions[id].accessToken }),
        ).resolves.toMatchObject({ userId: id, tenantStatus: 'active' });
      }
    });

    it.each(['supervisor', 'employee'] as const)(
      '%s: verify, login (after a correct password) and refresh are blocked',
      async (id) => {
        await deliver('subscription_cancelled');

        const verify = await errorOf(
          auth.verify({ accessToken: sessions[id].accessToken }),
        );
        const login = await errorOf(
          auth.login({ email: emailOf(id), password: PASSWORD }),
        );
        const refresh = await errorOf(
          auth.refresh({ refreshToken: sessions[id].refreshToken }),
        );

        expect(verify).toBeInstanceOf(TenantCancelledException);
        expect(login).toBeInstanceOf(TenantCancelledException);
        // Revoked by the cancellation, so refresh fails before the tenant rule.
        expect(refresh).toBeInstanceOf(InvalidTokenException);
        expect(
          refreshTokens.find(
            (t) => t.tokenHash === hashToken(sessions[id].refreshToken),
          )?.revokedAt,
        ).toBeInstanceOf(Date);
      },
    );

    it.each(['owner', 'admin'] as const)(
      '%s: verify returns tenantStatus cancelled, login and refresh still work',
      async (id) => {
        await deliver('subscription_cancelled');

        await expect(
          auth.verify({ accessToken: sessions[id].accessToken }),
        ).resolves.toMatchObject({
          userId: id,
          tenantId: TENANT_A,
          tenantStatus: 'cancelled',
        });
        await expect(
          auth.login({ email: emailOf(id), password: PASSWORD }),
        ).resolves.toHaveProperty('accessToken');
        await expect(
          auth.refresh({ refreshToken: sessions[id].refreshToken }),
        ).resolves.toHaveProperty('refreshToken');
      },
    );

    it('reactivation restores supervisor/employee access, but old refresh tokens stay revoked', async () => {
      await deliver('subscription_cancelled');
      await deliver('subscription_reactivated');

      await expect(
        auth.verify({ accessToken: sessions.supervisor.accessToken }),
      ).resolves.toMatchObject({
        userId: 'supervisor',
        tenantStatus: 'active',
      });
      await expect(
        auth.login({ email: emailOf('employee'), password: PASSWORD }),
      ).resolves.toHaveProperty('accessToken');
      expect(
        await errorOf(
          auth.refresh({ refreshToken: sessions.employee.refreshToken }),
        ),
      ).toBeInstanceOf(InvalidTokenException);
    });

    it('a user of another tenant is unaffected', async () => {
      tenants.push(tenant(TENANT_B, 'ACTIVE'));
      users.push(user('other', 'EMPLOYEE', TENANT_B));
      const other = await tokens.issueTokenPair(users[users.length - 1]);

      await deliver('subscription_cancelled');

      await expect(
        auth.verify({ accessToken: other.accessToken }),
      ).resolves.toMatchObject({ userId: 'other', tenantStatus: 'active' });
      expect(statusOf(TENANT_B)).toBe('ACTIVE');
    });
  });
});
