jest.mock('../../config', () => ({
  envs: {},
}));

jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
}));

import { TestClockService } from '../common/clock.service';
import { CONSUMED_SUBJECTS } from './consumed-events';
import { DataRetentionHandler } from './data-retention.handler';
import { TenantCreatedHandler } from './tenant-created.handler';

describe('Billing Consumed Events Handlers', () => {
  const tenantId = '0199b7e0-0000-7000-8000-000000000001';
  const now = new Date('2026-10-24T12:00:00.000Z');
  let clock: TestClockService;
  let mockProcessor: any;
  let mockEvents: any;

  beforeEach(() => {
    clock = new TestClockService(now);
    mockProcessor = {
      register: jest.fn(),
    };
    mockEvents = {
      publish: jest.fn().mockResolvedValue('0199b7e0-0000-7000-8000-000000000099'),
    };
  });

  describe('TenantCreatedHandler', () => {
    let handler: TenantCreatedHandler;

    beforeEach(() => {
      handler = new TenantCreatedHandler(mockProcessor, mockEvents, clock);
    });

    it('registers on authTenantCreated subject during onModuleInit', () => {
      handler.onModuleInit();
      expect(mockProcessor.register).toHaveBeenCalledWith({
        filter: CONSUMED_SUBJECTS.authTenantCreated,
        handle: expect.any(Function),
      });
    });

    it('creates PRO trial subscription and returns post-commit effect to publish event', async () => {
      const mockTx = {
        subscription: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'sub-1' }),
        },
      };

      const effects = await handler.apply({
        tx: mockTx as any,
        tenantId,
        eventId: '0199b7e0-0000-7000-8000-000000000010',
        occurredAt: now,
        payload: { tenantId, name: 'Acme', ownerId: '0199b7e0-0000-7000-8000-000000000020' },
      });

      const expectedTrialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      expect(mockTx.subscription.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          plan: 'PRO',
          status: 'TRIAL',
          trialEndsAt: expectedTrialEnd,
        },
      });

      expect(effects).toHaveLength(1);
      await effects[0]();

      expect(mockEvents.publish).toHaveBeenCalledWith({
        tenantId,
        event: 'subscription_created',
        payload: {
          plan: 'pro',
          features: {
            tasks: true,
            alerts: true,
            tower: true,
          },
          status: 'trial',
          trialEndsAt: expectedTrialEnd.toISOString(),
        },
      });
    });

    it('is a no-op when subscription already exists for tenant', async () => {
      const mockTx = {
        subscription: {
          findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', tenantId }),
          create: jest.fn(),
        },
      };

      const effects = await handler.apply({
        tx: mockTx as any,
        tenantId,
        eventId: '0199b7e0-0000-7000-8000-000000000010',
        occurredAt: now,
        payload: { tenantId, name: 'Acme' },
      });

      expect(mockTx.subscription.create).not.toHaveBeenCalled();
      expect(effects).toHaveLength(0);
    });
  });

  describe('DataRetentionHandler', () => {
    let handler: DataRetentionHandler;

    beforeEach(() => {
      handler = new DataRetentionHandler(mockProcessor);
    });

    it('registers on billingDataRetentionExpired subject during onModuleInit', () => {
      handler.onModuleInit();
      expect(mockProcessor.register).toHaveBeenCalledWith({
        filter: CONSUMED_SUBJECTS.billingDataRetentionExpired,
        handle: expect.any(Function),
      });
    });

    it('purges subscriptionPlanChange and clears payment links from invoices', async () => {
      const mockTx = {
        subscriptionPlanChange: {
          deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        invoice: {
          updateMany: jest.fn().mockResolvedValue({ count: 5 }),
        },
      };

      const effects = await handler.apply({
        tx: mockTx as any,
        tenantId,
        eventId: '0199b7e0-0000-7000-8000-000000000011',
        occurredAt: now,
        payload: { tenantId },
      });

      expect(mockTx.subscriptionPlanChange.deleteMany).toHaveBeenCalledWith({
        where: { tenantId },
      });
      expect(mockTx.invoice.updateMany).toHaveBeenCalledWith({
        where: { tenantId },
        data: {
          paymentLinkUrl: null,
          paymentLinkExpiresAt: null,
        },
      });
      expect(effects).toHaveLength(0);
    });
  });
});
