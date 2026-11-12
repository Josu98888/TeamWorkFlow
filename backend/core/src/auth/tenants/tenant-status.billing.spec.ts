import { Logger } from '@nestjs/common';
import { AUTH_EVENTS, subjectMatches } from '../events/auth.events';
import { ConsumedEventProcessor } from '../events/consumed-event.processor';
import type { ConsumedMessage } from '../events/jetstream.service';
import { TenantStatusBillingHandlers } from './tenant-status.billing.handlers';

jest.mock('../../config', () => ({ envs: {} }));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const AT = '2026-10-13T10:00:00.000Z';
const EARLIER = new Date('2026-10-01T00:00:00.000Z');

type Status = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED';
type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';
type BillingEvent =
  'payment_overdue' | 'subscription_expired' | 'payment_received';

interface StoredTenant {
  id: string;
  status: Status;
  pastDueSince: Date | null;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
}

interface StoredToken {
  id: string;
  tenantId: string | null;
  role: Role;
  revokedAt: Date | null;
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

// Covers: S7.1
describe('billing events that change the tenant status', () => {
  let tenants: StoredTenant[];
  let tokens: StoredToken[];
  let processed: Set<string>;
  let nextEventId: number;
  let tenantUpdateCount: number | undefined;
  let handlers: {
    filter: string;
    run: (m: ConsumedMessage) => Promise<void>;
  }[];
  const publish = jest.fn();
  const prisma = {
    tenant: { findUnique: jest.fn(), updateMany: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    processedEvent: { createMany: jest.fn() },
    $transaction: jest.fn(),
  };

  function eventId() {
    return `0199b7e0-0000-7000-8000-${String(nextEventId++).padStart(12, '0')}`;
  }

  // Delivers an event the way JetStreamService does: subject filter match, the
  // tenant of the subject and the parsed payload.
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

  const statusOf = (id = TENANT_A) => tenants.find((t) => t.id === id)?.status;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    tenants = [tenant(TENANT_A, 'ACTIVE')];
    tokens = [];
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
    prisma.refreshToken.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: {
          revokedAt: null;
          user: { tenantId: string; role: { in: Role[] } };
        };
        data: { revokedAt: Date };
      }) => {
        const hits = tokens.filter(
          (t) =>
            t.revokedAt === null &&
            t.tenantId === where.user.tenantId &&
            where.user.role.in.includes(t.role),
        );
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
          tokens: tokens.map((t) => ({ ...t })),
          processed: new Set(processed),
        };
        try {
          return await callback(prisma);
        } catch (error) {
          ({ tenants, tokens, processed } = snapshot);
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('transitions', () => {
    it('payment_overdue: active -> past_due, sets pastDueSince, emits tenant_past_due', async () => {
      await deliver('payment_overdue');

      expect(statusOf()).toBe('PAST_DUE');
      expect(tenants[0].pastDueSince).toEqual(new Date(AT));
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(
        TENANT_A,
        AUTH_EVENTS.tenantPastDue,
        { tenantId: TENANT_A, pastDueSince: AT },
      );
    });

    it('payment_overdue does not revoke any refresh token', async () => {
      tokens = [
        { id: 't1', tenantId: TENANT_A, role: 'EMPLOYEE', revokedAt: null },
      ];

      await deliver('payment_overdue');

      expect(tokens[0].revokedAt).toBeNull();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('subscription_expired: past_due -> suspended, keeps pastDueSince, emits tenant_suspended', async () => {
      tenants = [tenant(TENANT_A, 'PAST_DUE')];

      await deliver('subscription_expired');

      expect(statusOf()).toBe('SUSPENDED');
      expect(tenants[0].suspendedAt).toEqual(new Date(AT));
      expect(tenants[0].pastDueSince).toEqual(EARLIER);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(
        TENANT_A,
        AUTH_EVENTS.tenantSuspended,
        { tenantId: TENANT_A, suspendedAt: AT },
      );
    });

    it('subscription_expired while active also suspends', async () => {
      await deliver('subscription_expired');

      expect(statusOf()).toBe('SUSPENDED');
      expect(publish).toHaveBeenCalledWith(
        TENANT_A,
        AUTH_EVENTS.tenantSuspended,
        { tenantId: TENANT_A, suspendedAt: AT },
      );
    });

    it.each(['PAST_DUE', 'SUSPENDED'] as const)(
      'payment_received: %s -> active, clears pastDueSince and suspendedAt, emits tenant_reactivated',
      async (from) => {
        tenants = [{ ...tenant(TENANT_A, from), suspendedAt: EARLIER }];
        tenants[0].pastDueSince = EARLIER;

        await deliver('payment_received');

        expect(statusOf()).toBe('ACTIVE');
        expect(tenants[0].pastDueSince).toBeNull();
        expect(tenants[0].suspendedAt).toBeNull();
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith(
          TENANT_A,
          AUTH_EVENTS.tenantReactivated,
          { tenantId: TENANT_A },
        );
      },
    );
  });

  describe('suspension revokes sessions', () => {
    it('revokes supervisor and employee refresh tokens of that tenant only', async () => {
      const alreadyRevoked = new Date('2026-10-02T00:00:00.000Z');
      tenants = [tenant(TENANT_A, 'PAST_DUE'), tenant(TENANT_B, 'ACTIVE')];
      tokens = [
        { id: 'sup', tenantId: TENANT_A, role: 'SUPERVISOR', revokedAt: null },
        { id: 'emp', tenantId: TENANT_A, role: 'EMPLOYEE', revokedAt: null },
        { id: 'adm', tenantId: TENANT_A, role: 'ADMIN', revokedAt: null },
        { id: 'own', tenantId: TENANT_A, role: 'OWNER', revokedAt: null },
        {
          id: 'old',
          tenantId: TENANT_A,
          role: 'EMPLOYEE',
          revokedAt: alreadyRevoked,
        },
        { id: 'b', tenantId: TENANT_B, role: 'EMPLOYEE', revokedAt: null },
        { id: 'pa', tenantId: null, role: 'PLATFORM_ADMIN', revokedAt: null },
      ];

      await deliver('subscription_expired');

      const revoked = Object.fromEntries(
        tokens.map((t) => [t.id, t.revokedAt]),
      );
      expect(revoked.sup).toBeInstanceOf(Date);
      expect(revoked.emp).toBeInstanceOf(Date);
      expect(revoked.old).toBe(alreadyRevoked);
      expect(revoked.adm).toBeNull();
      expect(revoked.own).toBeNull();
      expect(revoked.b).toBeNull();
      expect(revoked.pa).toBeNull();
    });

    it('payment_received does not un-revoke tokens', async () => {
      tenants = [tenant(TENANT_A, 'SUSPENDED')];
      const revokedAt = new Date('2026-10-02T00:00:00.000Z');
      tokens = [{ id: 't', tenantId: TENANT_A, role: 'EMPLOYEE', revokedAt }];

      await deliver('payment_received');

      expect(tokens[0].revokedAt).toBe(revokedAt);
    });
  });

  describe('no-ops write nothing and emit nothing', () => {
    it.each<[BillingEvent, Status]>([
      ['payment_overdue', 'PAST_DUE'],
      ['payment_overdue', 'SUSPENDED'],
      ['payment_overdue', 'CANCELLED'],
      ['payment_overdue', 'DELETED'],
      ['subscription_expired', 'SUSPENDED'],
      ['subscription_expired', 'CANCELLED'],
      ['subscription_expired', 'DELETED'],
      ['payment_received', 'ACTIVE'],
      ['payment_received', 'CANCELLED'],
      ['payment_received', 'DELETED'],
    ])('%s while %s', async (event, status) => {
      tenants = [tenant(TENANT_A, status)];
      const before = { ...tenants[0] };
      tokens = [
        { id: 't', tenantId: TENANT_A, role: 'EMPLOYEE', revokedAt: null },
      ];

      await deliver(event);

      expect(tenants[0]).toEqual(before);
      expect(tokens[0].revokedAt).toBeNull();
      expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('an unknown tenant', async () => {
      tenants = [];

      await expect(deliver('subscription_expired')).resolves.toBeUndefined();

      expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('idempotency and tenant isolation', () => {
    it('a duplicate eventId is a no-op: one write and one emitted event', async () => {
      const id = eventId();

      await deliver('payment_overdue', { eventId: id });
      await deliver('payment_overdue', { eventId: id });

      expect(prisma.tenant.updateMany).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledTimes(1);
    });

    it('a duplicate does not undo what a later event did', async () => {
      const first = eventId();
      await deliver('payment_overdue', { eventId: first });
      await deliver('payment_received');
      publish.mockClear();

      await deliver('payment_overdue', { eventId: first });

      expect(statusOf()).toBe('ACTIVE');
      expect(publish).not.toHaveBeenCalled();
    });

    it('a different eventId with the same effect is a state no-op and emits nothing', async () => {
      await deliver('payment_overdue');
      publish.mockClear();

      await deliver('payment_overdue');

      expect(statusOf()).toBe('PAST_DUE');
      expect(publish).not.toHaveBeenCalled();
    });

    it('an event of tenant B never touches tenant A', async () => {
      tenants = [tenant(TENANT_A, 'ACTIVE'), tenant(TENANT_B, 'ACTIVE')];
      tokens = [
        { id: 'a', tenantId: TENANT_A, role: 'EMPLOYEE', revokedAt: null },
        { id: 'b', tenantId: TENANT_B, role: 'EMPLOYEE', revokedAt: null },
      ];

      await deliver('subscription_expired', { tenantId: TENANT_B });

      expect(statusOf(TENANT_A)).toBe('ACTIVE');
      expect(statusOf(TENANT_B)).toBe('SUSPENDED');
      expect(tokens[0].revokedAt).toBeNull();
      expect(tokens[1].revokedAt).toBeInstanceOf(Date);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(
        TENANT_B,
        AUTH_EVENTS.tenantSuspended,
        expect.anything(),
      );
    });

    it('a subject tenant that differs from the payload tenant changes nothing', async () => {
      tenants = [tenant(TENANT_A, 'ACTIVE'), tenant(TENANT_B, 'ACTIVE')];

      await deliver('subscription_expired', {
        tenantId: TENANT_A,
        payloadTenantId: TENANT_B,
      });

      expect(tenants.map((t) => t.status)).toEqual(['ACTIVE', 'ACTIVE']);
      expect(processed.size).toBe(0);
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    it('a concurrent status change rejects (redelivery), rolls back and emits nothing', async () => {
      tokens = [
        { id: 't', tenantId: TENANT_A, role: 'EMPLOYEE', revokedAt: null },
      ];
      tenantUpdateCount = 0;

      await expect(deliver('subscription_expired')).rejects.toThrow(
        'Tenant status changed concurrently',
      );

      expect(processed.size).toBe(0);
      expect(tokens[0].revokedAt).toBeNull();
      expect(publish).not.toHaveBeenCalled();
    });

    it('a failure revoking tokens rolls the status back and emits nothing', async () => {
      prisma.refreshToken.updateMany.mockRejectedValueOnce(new Error('db'));

      await expect(deliver('subscription_expired')).rejects.toThrow('db');

      expect(statusOf()).toBe('ACTIVE');
      expect(processed.size).toBe(0);
      expect(publish).not.toHaveBeenCalled();
    });

    it('emits only after the transaction committed', async () => {
      let committed = false;
      prisma.$transaction.mockImplementation(
        async (callback: (tx: typeof prisma) => Promise<unknown>) => {
          const result = await callback(prisma);
          committed = true;
          return result;
        },
      );
      publish.mockImplementation(() => {
        expect(committed).toBe(true);
        return Promise.resolve();
      });

      await deliver('payment_overdue');

      expect(publish).toHaveBeenCalledTimes(1);
    });
  });
});
