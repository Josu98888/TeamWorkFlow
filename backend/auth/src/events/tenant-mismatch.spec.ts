import { Logger } from '@nestjs/common';
import { EmployeeCreatedHandlers } from '../invitations/employee-created.handlers';
import { TenantPlanHandlers } from '../tenants/tenant-plan.handlers';
import { TenantPurgeHandlers } from '../tenants/tenant-purge.handlers';
import { TenantStatusBillingHandlers } from '../tenants/tenant-status.billing.handlers';
import { CONSUMED_SUBJECTS, subjectMatches } from './auth.events';
import { ConsumedEventProcessor } from './consumed-event.processor';
import type { ConsumedMessage } from './jetstream.service';

jest.mock('../config', () => ({ envs: {} }));
jest.mock('../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: { DbNull: 'DbNull' },
}));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const EVENT_ID = '0199b7e0-0000-7000-8000-0000000000e1';
const OCCURRED_AT = '2026-10-13T10:00:00.000Z';

// Subjects of every consumed event, with the extra fields a valid payload has.
const EVENTS: [string, string, Record<string, unknown>][] = [
  ['billing.payment_overdue', CONSUMED_SUBJECTS.paymentOverdue, {}],
  ['billing.subscription_expired', CONSUMED_SUBJECTS.subscriptionExpired, {}],
  [
    'billing.subscription_cancelled',
    CONSUMED_SUBJECTS.subscriptionCancelled,
    {},
  ],
  [
    'billing.subscription_reactivated',
    CONSUMED_SUBJECTS.subscriptionReactivated,
    {},
  ],
  [
    'billing.plan_changed',
    CONSUMED_SUBJECTS.planChanged,
    { plan: 'pro', features: {}, effectiveAt: OCCURRED_AT },
  ],
  [
    'billing.data_retention_expired',
    CONSUMED_SUBJECTS.dataRetentionExpired,
    {},
  ],
  [
    'organization.employee_created',
    CONSUMED_SUBJECTS.employeeCreated,
    { email: 'employee@example.com' },
  ],
];

// Covers: S7.5
describe('subject/payload tenant mismatch on consumed events', () => {
  let handlers: {
    filter: string;
    run: (m: ConsumedMessage) => Promise<void>;
  }[];
  let errorLog: jest.SpyInstance;
  // Every database method is a mock: a rejected event must reach none of them.
  const prisma = {
    $transaction: jest.fn(),
    processedEvent: { createMany: jest.fn(), deleteMany: jest.fn() },
    tenant: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { deleteMany: jest.fn(), findUnique: jest.fn() },
    refreshToken: { updateMany: jest.fn(), deleteMany: jest.fn() },
    passwordResetToken: { deleteMany: jest.fn() },
    invitation: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const publish = jest.fn();

  function writes() {
    return [
      prisma.$transaction,
      prisma.processedEvent.createMany,
      prisma.processedEvent.deleteMany,
      prisma.tenant.findUnique,
      prisma.tenant.updateMany,
      prisma.user.deleteMany,
      prisma.user.findUnique,
      prisma.refreshToken.updateMany,
      prisma.refreshToken.deleteMany,
      prisma.passwordResetToken.deleteMany,
      prisma.invitation.create,
      prisma.invitation.deleteMany,
      prisma.invitation.findFirst,
      publish,
    ];
  }

  function deliver(
    filter: string,
    extra: Record<string, unknown>,
    subjectTenant: string | null,
    payloadFields: Record<string, unknown>,
  ) {
    const subject = filter.replace('t.*', `t.${TENANT_A}`);
    const handler = handlers.find((h) => subjectMatches(h.filter, subject));
    if (!handler) throw new Error(`No handler for ${subject}`);
    return handler.run({
      subject,
      tenantId: subjectTenant,
      payload: {
        eventId: EVENT_ID,
        occurredAt: OCCURRED_AT,
        ...extra,
        ...payloadFields,
      },
    });
  }

  beforeEach(() => {
    jest.resetAllMocks();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    handlers = [];

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
    new TenantPlanHandlers(processor).onModuleInit();
    new TenantPurgeHandlers(processor).onModuleInit();
    new EmployeeCreatedHandlers(processor).onModuleInit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(EVENTS)('%s', (_name, filter, extra) => {
    it('a payload for another tenant is not applied, is acked and logged without payload', async () => {
      await expect(
        deliver(filter, extra, TENANT_A, { tenantId: TENANT_B }),
      ).resolves.toBeUndefined();

      for (const mock of writes()) expect(mock).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
      const logged = String(errorLog.mock.calls[0][0]);
      // The subject (routing key, with the subject tenant) is logged; nothing
      // from the payload is.
      for (const secret of [TENANT_B, EVENT_ID, 'employee@example.com']) {
        expect(logged).not.toContain(secret);
      }
    });

    it.each([
      ['a missing tenantId', undefined],
      ['an empty tenantId', ''],
      ['a tenantId that is not a uuid', 'tenant-a'],
      ['a null tenantId', null],
      ['the tenant of the subject in another case', TENANT_A.toUpperCase()],
    ])('%s in the payload is not applied either', async (_label, tenantId) => {
      const fields = tenantId === undefined ? {} : { tenantId };

      await expect(
        deliver(filter, extra, TENANT_A, fields),
      ).resolves.toBeUndefined();

      for (const mock of writes()) expect(mock).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('a subject without a tenant is not applied', async () => {
      await expect(
        deliver(filter, extra, null, { tenantId: TENANT_A }),
      ).resolves.toBeUndefined();

      for (const mock of writes()) expect(mock).not.toHaveBeenCalled();
    });
  });

  it('control: when subject and payload agree the employee_created handler runs', async () => {
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) =>
        Promise.resolve(callback(prisma)),
    );
    prisma.processedEvent.createMany.mockResolvedValue({ count: 1 });
    prisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.invitation.findFirst.mockResolvedValue(null);

    await deliver(
      CONSUMED_SUBJECTS.employeeCreated,
      { email: 'employee@example.com' },
      TENANT_A,
      { tenantId: TENANT_A },
    );

    expect(prisma.invitation.create).toHaveBeenCalledTimes(1);
    expect(prisma.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_A,
        email: 'employee@example.com',
        invitedById: null,
      }) as unknown,
    });
    expect(errorLog).not.toHaveBeenCalled();
  });
});
