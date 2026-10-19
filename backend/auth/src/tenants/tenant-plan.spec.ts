import { Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { envs } from '../config';
import { subjectMatches } from '../events/auth.events';
import { ConsumedEventProcessor } from '../events/consumed-event.processor';
import { JetStreamService } from '../events/jetstream.service';
import type { ConsumedMessage } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPlanHandlers } from './tenant-plan.handlers';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const T1 = '2026-10-01T00:00:00.000Z';
const T2 = '2026-10-05T00:00:00.000Z';
const T3 = '2026-10-10T00:00:00.000Z';
const PRO = { tasks: true, alerts: true, tower: true };
const BASIC = { tasks: true, alerts: false, tower: false };

type Status = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED';
type PlanEvent = 'subscription_created' | 'plan_changed';

interface StoredTenant {
  id: string;
  status: Status;
  plan: 'BASIC' | 'PRO' | null;
  features: Record<string, boolean> | null;
  planUpdatedAt: Date | null;
}

interface TenantWhere {
  id: string;
  status: { not: Status };
  OR: ({ planUpdatedAt: null } | { planUpdatedAt: { lte: Date } })[];
}

function tenant(id: string, status: Status = 'ACTIVE'): StoredTenant {
  return { id, status, plan: null, features: null, planUpdatedAt: null };
}

// Covers: S7.3
describe('subscription_created and plan_changed', () => {
  let tenants: StoredTenant[];
  let processed: Set<string>;
  let nextEventId: number;
  let auth: AuthService;
  let tokens: TokenService;
  let handlers: {
    filter: string;
    run: (m: ConsumedMessage) => Promise<void>;
  }[];
  let errorLog: jest.SpyInstance;
  const publish = jest.fn();
  const prisma = {
    tenant: { updateMany: jest.fn() },
    user: { findUnique: jest.fn() },
    processedEvent: { createMany: jest.fn() },
    $transaction: jest.fn(),
  };

  function eventId() {
    return `0199b7e0-0000-7000-8000-${String(nextEventId++).padStart(12, '0')}`;
  }

  // Delivers an event the way JetStreamService does.
  function deliver(
    event: PlanEvent,
    fields: Record<string, unknown>,
    options: {
      tenantId?: string;
      payloadTenantId?: string;
      eventId?: string;
      occurredAt?: string;
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
        occurredAt: options.occurredAt ?? T1,
        ...fields,
      },
    });
  }

  const created = (
    plan: unknown,
    features: unknown,
    options?: Parameters<typeof deliver>[2],
  ) => deliver('subscription_created', { plan, features }, options);

  const changed = (
    plan: unknown,
    features: unknown,
    effectiveAt: unknown,
    options?: Parameters<typeof deliver>[2],
  ) => deliver('plan_changed', { plan, features, effectiveAt }, options);

  const tenantOf = (id = TENANT_A) => tenants.find((t) => t.id === id)!;

  async function verified() {
    const pair = await tokens.issueTokenPair({
      id: 'owner',
      tenantId: TENANT_A,
      role: 'OWNER',
    });
    return auth.verify({ accessToken: pair.accessToken });
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    tenants = [tenant(TENANT_A)];
    processed = new Set();
    nextEventId = 1;
    handlers = [];

    // Evaluates the stale check the way the database does.
    prisma.tenant.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: TenantWhere;
        data: Pick<StoredTenant, 'plan' | 'features' | 'planUpdatedAt'>;
      }) => {
        const hits = tenants.filter(
          (t) =>
            t.id === where.id &&
            t.status !== where.status.not &&
            where.OR.some((clause) =>
              clause.planUpdatedAt === null
                ? t.planUpdatedAt === null
                : t.planUpdatedAt !== null &&
                  t.planUpdatedAt.getTime() <=
                    clause.planUpdatedAt.lte.getTime(),
            ),
        );
        hits.forEach((t) => Object.assign(t, data));
        return Promise.resolve({ count: hits.length });
      },
    );
    prisma.user.findUnique.mockImplementation(() => {
      const found = tenants.find((t) => t.id === TENANT_A)!;
      return Promise.resolve({
        id: 'owner',
        tenantId: TENANT_A,
        role: 'OWNER',
        isActive: true,
        siteIds: [],
        tenant: found,
      });
    });
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
          processed: new Set(processed),
        };
        try {
          return await callback(prisma);
        } catch (error) {
          ({ tenants, processed } = snapshot);
          throw error;
        }
      },
    );

    const jetstream = {
      registerHandler: (
        filter: string,
        run: (m: ConsumedMessage) => Promise<void>,
      ) => handlers.push({ filter, run }),
      publish,
    };
    new TenantPlanHandlers(
      new ConsumedEventProcessor(prisma as never, jetstream as never),
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
        {
          provide: PrismaService,
          useValue: {
            ...prisma,
            refreshToken: { create: jest.fn().mockResolvedValue({}) },
          },
        },
        { provide: JetStreamService, useValue: { publish } },
      ],
    }).compile();
    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(TokenService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('storing the plan', () => {
    it('subscription_created stores plan, features and occurredAt, and verify returns them', async () => {
      await expect(verified()).resolves.toMatchObject({
        plan: null,
        features: null,
      });

      await created('pro', PRO, { occurredAt: T1 });

      expect(tenantOf()).toMatchObject({
        plan: 'PRO',
        features: PRO,
        planUpdatedAt: new Date(T1),
      });
      await expect(verified()).resolves.toMatchObject({
        tenantId: TENANT_A,
        plan: 'pro',
        features: PRO,
      });
    });

    it('plan_changed replaces them and uses effectiveAt, not occurredAt', async () => {
      await created('pro', PRO, { occurredAt: T1 });

      await changed('basic', BASIC, T3, { occurredAt: T2 });

      expect(tenantOf()).toMatchObject({
        plan: 'BASIC',
        features: BASIC,
        planUpdatedAt: new Date(T3),
      });
      await expect(verified()).resolves.toMatchObject({
        plan: 'basic',
        features: BASIC,
      });
    });

    it('emits nothing (AGENTS defines no event for a plan change)', async () => {
      await created('pro', PRO);
      await changed('basic', BASIC, T2);

      expect(publish).not.toHaveBeenCalled();
    });

    it('ignores extra fields of the payload and accepts empty features', async () => {
      await deliver('subscription_created', {
        plan: 'basic',
        features: {},
        status: 'trial',
        trialEndsAt: T3,
      });

      expect(tenantOf()).toMatchObject({ plan: 'BASIC', features: {} });
    });

    it('applies to a cancelled tenant (a resubscription sends plan_changed first)', async () => {
      tenants = [tenant(TENANT_A, 'CANCELLED')];

      await changed('pro', PRO, T2);

      expect(tenantOf()).toMatchObject({ plan: 'PRO', features: PRO });
      expect(tenantOf().status).toBe('CANCELLED');
    });

    it.each(['ACTIVE', 'PAST_DUE', 'SUSPENDED'] as const)(
      'applies to a %s tenant without touching its status',
      async (status) => {
        tenants = [tenant(TENANT_A, status)];

        await created('pro', PRO);

        expect(tenantOf()).toMatchObject({ plan: 'PRO', status });
      },
    );
  });

  describe('stale events', () => {
    it('an older plan_changed after a newer one leaves the newer plan', async () => {
      await changed('pro', PRO, T3);

      await changed('basic', BASIC, T2);

      expect(tenantOf()).toMatchObject({
        plan: 'PRO',
        features: PRO,
        planUpdatedAt: new Date(T3),
      });
      await expect(verified()).resolves.toMatchObject({ plan: 'pro' });
    });

    it('a subscription_created that arrives after a newer plan_changed is ignored', async () => {
      await changed('basic', BASIC, T3);

      await created('pro', PRO, { occurredAt: T1 });

      expect(tenantOf()).toMatchObject({ plan: 'BASIC', features: BASIC });
    });

    it('a newer event replaces an older one', async () => {
      await changed('basic', BASIC, T1);

      await changed('pro', PRO, T2);

      expect(tenantOf()).toMatchObject({ plan: 'PRO', features: PRO });
    });

    it('an event with the same instant as the stored one is applied (delivery order wins)', async () => {
      await changed('basic', BASIC, T2);

      await changed('pro', PRO, T2);

      expect(tenantOf()).toMatchObject({ plan: 'PRO', features: PRO });
    });
  });

  describe('idempotency and isolation', () => {
    it('the same eventId twice is a no-op: one write', async () => {
      const id = eventId();

      await created('pro', PRO, { eventId: id });
      await created('pro', PRO, { eventId: id });

      expect(prisma.tenant.updateMany).toHaveBeenCalledTimes(1);
    });

    it('a duplicate does not undo what a later event did', async () => {
      const first = eventId();
      await created('pro', PRO, { eventId: first, occurredAt: T1 });
      await changed('basic', BASIC, T2);

      await created('pro', PRO, { eventId: first, occurredAt: T1 });

      expect(tenantOf()).toMatchObject({ plan: 'BASIC' });
    });

    it('another eventId with the same content leaves the same state', async () => {
      await created('pro', PRO);
      const before = { ...tenantOf() };

      await created('pro', PRO);

      expect(tenantOf()).toEqual(before);
    });

    it('an event of tenant B never touches tenant A', async () => {
      tenants = [tenant(TENANT_A), tenant(TENANT_B)];

      await created('pro', PRO, { tenantId: TENANT_B });

      expect(tenantOf(TENANT_A).plan).toBeNull();
      expect(tenantOf(TENANT_B).plan).toBe('PRO');
    });

    it('a deleted tenant (tombstone) keeps no plan', async () => {
      tenants = [tenant(TENANT_A, 'DELETED')];

      await created('pro', PRO);

      expect(tenantOf()).toMatchObject({ plan: null, features: null });
    });

    it('an unknown tenant is a no-op that resolves (ack)', async () => {
      tenants = [];

      await expect(created('pro', PRO)).resolves.toBeUndefined();

      expect(tenants).toEqual([]);
    });

    it('a subject tenant that differs from the payload tenant changes nothing', async () => {
      tenants = [tenant(TENANT_A), tenant(TENANT_B)];

      await created('pro', PRO, {
        tenantId: TENANT_A,
        payloadTenantId: TENANT_B,
      });

      expect(tenants.map((t) => t.plan)).toEqual([null, null]);
      expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
    });

    it('a database failure rejects (redelivery) and records nothing', async () => {
      prisma.tenant.updateMany.mockRejectedValueOnce(new Error('db'));

      await expect(created('pro', PRO)).rejects.toThrow('db');

      expect(processed.size).toBe(0);
    });
  });

  describe('invalid payloads are poison: nothing written, acked, logged without payload', () => {
    it.each<[string, PlanEvent, Record<string, unknown>]>([
      [
        'an unknown plan',
        'subscription_created',
        { plan: 'enterprise', features: PRO },
      ],
      [
        'a Prisma-cased plan',
        'subscription_created',
        { plan: 'PRO', features: PRO },
      ],
      ['a missing plan', 'subscription_created', { features: PRO }],
      ['missing features', 'subscription_created', { plan: 'pro' }],
      [
        'null features',
        'subscription_created',
        { plan: 'pro', features: null },
      ],
      [
        'array features',
        'plan_changed',
        { plan: 'pro', features: [true], effectiveAt: T2 },
      ],
      [
        'a non-boolean feature',
        'plan_changed',
        { plan: 'pro', features: { tasks: 'yes' }, effectiveAt: T2 },
      ],
      ['a missing effectiveAt', 'plan_changed', { plan: 'pro', features: PRO }],
      [
        'an invalid effectiveAt',
        'plan_changed',
        { plan: 'pro', features: PRO, effectiveAt: 'soon' },
      ],
      [
        'a non-string effectiveAt',
        'plan_changed',
        { plan: 'pro', features: PRO, effectiveAt: 12 },
      ],
    ])('%s', async (_name, event, fields) => {
      await expect(deliver(event, fields)).resolves.toBeUndefined();

      expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
      expect(tenantOf()).toMatchObject({ plan: null, features: null });
      expect(processed.size).toBe(0);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(String(errorLog.mock.calls[0][0])).not.toContain('enterprise');
    });
  });
});
