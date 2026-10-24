import { Logger } from '@nestjs/common';
import { subjectMatches } from '../events/auth.events';
import { ConsumedEventProcessor } from '../events/consumed-event.processor';
import type { ConsumedMessage } from '../events/jetstream.service';
import { EmployeeCreatedHandlers } from './employee-created.handlers';

jest.mock('../../config', () => ({ envs: {} }));
jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
  Prisma: { DbNull: 'DbNull' },
}));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const AT = '2026-10-13T10:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

type Status = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED';

interface StoredInvitation {
  tenantId: string;
  email: string;
  role: string;
  tokenHash: string;
  invitedById: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

interface PendingWhere {
  tenantId: string;
  email: string;
  expiresAt: { gt: Date };
}

// Covers: S8.1
describe('employee_created consumer', () => {
  let handlers: {
    filter: string;
    run: (m: ConsumedMessage) => Promise<void>;
  }[];
  let tenants: Map<string, Status>;
  let users: Set<string>;
  let invitations: StoredInvitation[];
  let processed: Set<string>;
  let nextEventId: number;
  let errorLog: jest.SpyInstance;
  const publish = jest.fn();
  const prisma = {
    $transaction: jest.fn(),
    processedEvent: { createMany: jest.fn() },
    tenant: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    invitation: { findFirst: jest.fn(), create: jest.fn() },
  };

  const eventId = () =>
    `0199b7e0-0000-7000-8000-${String(nextEventId++).padStart(12, '0')}`;

  function deliver(
    fields: Record<string, unknown>,
    options: { tenantId?: string; eventId?: string } = {},
  ) {
    const tenantId = options.tenantId ?? TENANT_A;
    const subject = `t.${tenantId}.organization.employee_created`;
    const handler = handlers.find(({ filter }) =>
      subjectMatches(filter, subject),
    );
    if (!handler) throw new Error(`No handler for ${subject}`);
    return handler.run({
      subject,
      tenantId,
      payload: {
        eventId: options.eventId ?? eventId(),
        tenantId,
        occurredAt: AT,
        employeeId: 'employee-1',
        firstName: 'Ana',
        lastName: 'Diaz',
        ...fields,
      },
    });
  }

  const invitationsOf = (tenantId = TENANT_A) =>
    invitations.filter((i) => i.tenantId === tenantId);

  function pendingInvitation(
    overrides: Partial<StoredInvitation> = {},
  ): StoredInvitation {
    return {
      tenantId: TENANT_A,
      email: 'ana@example.com',
      role: 'ADMIN',
      tokenHash: 'existing',
      invitedById: 'owner-1',
      expiresAt: new Date(Date.now() + DAY),
      usedAt: null,
      revokedAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    tenants = new Map<string, Status>([[TENANT_A, 'ACTIVE']]);
    users = new Set();
    invitations = [];
    processed = new Set();
    nextEventId = 1;
    handlers = [];

    prisma.tenant.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        const status = tenants.get(where.id);
        return Promise.resolve(status ? { status } : null);
      },
    );
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { email: string } }) =>
        Promise.resolve(users.has(where.email) ? { id: 'user' } : null),
    );
    prisma.invitation.findFirst.mockImplementation(
      ({ where }: { where: PendingWhere }) => {
        const found = invitations.find(
          (i) =>
            i.tenantId === where.tenantId &&
            i.email === where.email &&
            i.usedAt === null &&
            i.revokedAt === null &&
            i.expiresAt > where.expiresAt.gt,
        );
        return Promise.resolve(found ? { id: 'pending' } : null);
      },
    );
    prisma.invitation.create.mockImplementation(
      ({ data }: { data: Omit<StoredInvitation, 'usedAt' | 'revokedAt'> }) => {
        invitations.push({ ...data, usedAt: null, revokedAt: null });
        return Promise.resolve({ id: 'new' });
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
          invitations: invitations.map((i) => ({ ...i })),
          processed: new Set(processed),
        };
        try {
          return await callback(prisma);
        } catch (error) {
          ({ invitations, processed } = snapshot);
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
    new EmployeeCreatedHandlers(
      new ConsumedEventProcessor(prisma as never, jetstream as never),
    ).onModuleInit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates an employee invitation with no inviter, a hashed token and a 7-day expiry', async () => {
    const before = Date.now();

    await deliver({ email: 'ana@example.com' });

    expect(invitationsOf()).toHaveLength(1);
    const [invitation] = invitationsOf();
    expect(invitation).toMatchObject({
      tenantId: TENANT_A,
      email: 'ana@example.com',
      role: 'EMPLOYEE',
      invitedById: null,
      usedAt: null,
      revokedAt: null,
    });
    expect(invitation.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const ttl = invitation.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(7 * DAY);
    expect(ttl).toBeLessThan(7 * DAY + 60_000);
    // AGENTS lists no event for it, and the raw token is not published.
    expect(publish).not.toHaveBeenCalled();
  });

  it('normalizes the email like registration', async () => {
    await deliver({ email: '  Ana@Example.COM ' });

    expect(invitationsOf().map((i) => i.email)).toEqual(['ana@example.com']);
  });

  it('the same event twice creates one invitation', async () => {
    const id = eventId();

    await deliver({ email: 'ana@example.com' }, { eventId: id });
    await deliver({ email: 'ana@example.com' }, { eventId: id });

    expect(invitationsOf()).toHaveLength(1);
  });

  it('two events for the same email create one invitation', async () => {
    await deliver({ email: 'ana@example.com' });
    await deliver({ email: 'ANA@example.com' });

    expect(invitationsOf()).toHaveLength(1);
  });

  it('an email that belongs to a user creates nothing', async () => {
    users.add('ana@example.com');

    await deliver({ email: 'ana@example.com' });

    expect(invitations).toHaveLength(0);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('an existing pending invitation is not duplicated nor replaced', async () => {
    const existing = pendingInvitation();
    invitations.push(existing);

    await deliver({ email: 'ana@example.com' });

    expect(invitations).toEqual([existing]);
  });

  it.each([
    ['used', { usedAt: new Date() }],
    ['revoked', { revokedAt: new Date() }],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
  ])('a %s invitation does not block a new one', async (_label, overrides) => {
    invitations.push(pendingInvitation(overrides));

    await deliver({ email: 'ana@example.com' });

    expect(invitations).toHaveLength(2);
    expect(invitations[1]).toMatchObject({ role: 'EMPLOYEE' });
  });

  it('a pending invitation of another tenant does not block it', async () => {
    tenants.set(TENANT_B, 'ACTIVE');
    invitations.push(pendingInvitation({ tenantId: TENANT_B }));

    await deliver({ email: 'ana@example.com' });

    expect(invitationsOf(TENANT_A)).toHaveLength(1);
    expect(invitationsOf(TENANT_B)).toHaveLength(1);
  });

  it('a deleted tenant gets nothing', async () => {
    tenants.set(TENANT_A, 'DELETED');

    await deliver({ email: 'ana@example.com' });

    expect(invitations).toHaveLength(0);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('an unknown tenant gets nothing', async () => {
    tenants.clear();

    await deliver({ email: 'ana@example.com' });

    expect(invitations).toHaveLength(0);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each(['PAST_DUE', 'SUSPENDED', 'CANCELLED'] as const)(
    'a %s tenant still gets the invitation',
    async (status) => {
      tenants.set(TENANT_A, status);

      await deliver({ email: 'ana@example.com' });

      expect(invitationsOf()).toHaveLength(1);
    },
  );

  it.each([
    ['a missing email', {}],
    ['a null email', { email: null }],
    ['a number', { email: 5 }],
    ['an empty email', { email: '   ' }],
    ['a malformed email', { email: 'not-an-email' }],
    ['a too long email', { email: `${'a'.repeat(250)}@example.com` }],
  ])('%s is poison: nothing written, acked, logged', async (_label, fields) => {
    await expect(deliver(fields)).resolves.toBeUndefined();

    expect(invitations).toHaveLength(0);
    expect(prisma.invitation.create).not.toHaveBeenCalled();
    expect(processed.size).toBe(0);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0][0])).not.toContain('not-an-email');
  });
});
