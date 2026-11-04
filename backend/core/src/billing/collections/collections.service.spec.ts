import { TestClockService } from '../common/clock.service';
import { BILLING_EVENTS } from '../events/billing.events';
import { CollectionsService } from './collections.service';
import type { BillingEventsService } from '../events/billing-events.service';
import type { BillingPrismaService } from '../prisma/prisma.service';

jest.mock('../../config', () => ({
  envs: {
    graceDays: 7,
    dataRetentionDays: 90,
  },
}));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

describe('CollectionsService', () => {
  let service: CollectionsService;
  let mockPrisma: any;
  let mockEvents: any;
  let clock: TestClockService;

  beforeEach(() => {
    clock = new TestClockService('2026-10-11T09:00:00.000Z');
    mockPrisma = {
      invoice: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      subscription: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      subscriptionPlanChange: {
        deleteMany: jest.fn(),
      },
    };
    mockEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
      publishNotification: jest.fn().mockResolvedValue(undefined),
    };
    service = new CollectionsService(
      mockPrisma as unknown as BillingPrismaService,
      mockEvents as unknown as BillingEventsService,
      clock,
    );
  });

  describe('processCollections', () => {
    it('sends billing_due_soon 3 days before due date', async () => {
      // Due on Oct 14, now is Oct 11 -> 3 days until due
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        {
          id: 'inv-1',
          tenantId: 'tenant-1',
          dueDate: new Date('2026-10-14T09:00:00.000Z'),
        },
      ]);
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        status: 'ACTIVE',
      });

      await service.processCollections();

      expect(mockEvents.publishNotification).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          templateCode: 'billing_due_soon',
          eventId: 'billing:billing_due_soon:inv-1',
        }),
      );
    });

    it('sets subscription PAST_DUE and emits payment_overdue on delay day 1', async () => {
      // Due on Oct 10, now is Oct 11 -> diff is 1 day -> delay day 1
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        {
          id: 'inv-1',
          tenantId: 'tenant-1',
          dueDate: new Date('2026-10-10T09:00:00.000Z'),
        },
      ]);
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        status: 'ACTIVE',
      });
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.processCollections();

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'PAST_DUE' },
      });
      expect(mockEvents.publish).toHaveBeenCalledWith(
        'tenant-1',
        BILLING_EVENTS.paymentOverdue,
        expect.objectContaining({ invoiceId: 'inv-1' }),
      );
      expect(mockEvents.publishNotification).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          templateCode: 'billing_overdue_notice',
          eventId: 'billing:billing_overdue_notice:inv-1:1',
          data: expect.objectContaining({ delayDay: 1 }),
        }),
      );
    });

    it('sets subscription SUSPENDED and emits subscription_expired on delay day 7 (grace period end)', async () => {
      // Due on Oct 4, now is Oct 11 -> diff is 7 days -> delay day 8 >= graceDays (7)
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        {
          id: 'inv-1',
          tenantId: 'tenant-1',
          dueDate: new Date('2026-10-04T09:00:00.000Z'),
        },
      ]);
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        status: 'PAST_DUE',
      });
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.processCollections();

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'SUSPENDED' },
      });
      expect(mockEvents.publish).toHaveBeenCalledWith(
        'tenant-1',
        BILLING_EVENTS.subscriptionExpired,
        {},
      );
      expect(mockEvents.publishNotification).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          templateCode: 'billing_suspended',
          eventId: 'billing:billing_suspended:inv-1',
        }),
      );
    });

    it('skips collections for cancelled subscriptions', async () => {
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        {
          id: 'inv-1',
          tenantId: 'tenant-cancelled',
          dueDate: new Date('2026-10-01T09:00:00.000Z'),
        },
      ]);
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(null); // cancelled

      await service.processCollections();

      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      expect(mockEvents.publish).not.toHaveBeenCalled();
    });
  });

  describe('processDataRetention', () => {
    it('sends data deletion warning 7 days before retention expiration (day 83)', async () => {
      // Ended 83 days ago
      const endedAt = new Date(
        clock.now().getTime() - 83 * 24 * 60 * 60 * 1000,
      );
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        {
          id: 'sub-cancelled',
          tenantId: 'tenant-1',
          status: 'CANCELLED',
          endedAt,
          dataRetentionWarningSentAt: null,
          dataRetentionExpiredAt: null,
        },
      ]);
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(null); // no resubscription
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.processDataRetention();

      expect(mockEvents.publishNotification).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          templateCode: 'billing_data_deletion_warning',
          eventId: 'billing:billing_data_deletion_warning:sub-cancelled',
        }),
      );
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-cancelled' },
        data: expect.objectContaining({
          dataRetentionWarningSentAt: expect.any(Date),
        }),
      });
    });

    it('emits data_retention_expired after 90 days of cancellation', async () => {
      // Ended 91 days ago
      const endedAt = new Date(
        clock.now().getTime() - 91 * 24 * 60 * 60 * 1000,
      );
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        {
          id: 'sub-cancelled',
          tenantId: 'tenant-1',
          status: 'CANCELLED',
          endedAt,
          dataRetentionWarningSentAt: new Date(),
          dataRetentionExpiredAt: null,
        },
      ]);
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(null);
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.processDataRetention();

      expect(mockEvents.publish).toHaveBeenCalledWith(
        'tenant-1',
        BILLING_EVENTS.dataRetentionExpired,
        {},
      );
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-cancelled' },
        data: expect.objectContaining({
          dataRetentionExpiredAt: expect.any(Date),
        }),
      });
    });

    it('skips data retention actions if tenant resubscribed', async () => {
      const endedAt = new Date(
        clock.now().getTime() - 91 * 24 * 60 * 60 * 1000,
      );
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        {
          id: 'sub-cancelled',
          tenantId: 'tenant-1',
          status: 'CANCELLED',
          endedAt,
        },
      ]);
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'new-active-sub',
        status: 'ACTIVE',
      });

      await service.processDataRetention();

      expect(mockEvents.publish).not.toHaveBeenCalled();
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe('purgeTenantData', () => {
    it('deletes plan changes and clears invoice payment links', async () => {
      mockPrisma.subscriptionPlanChange.deleteMany.mockResolvedValue({});
      mockPrisma.invoice.updateMany.mockResolvedValue({});

      await service.purgeTenantData('tenant-purge');

      expect(mockPrisma.subscriptionPlanChange.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-purge' },
      });
      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-purge' },
        data: { paymentLinkUrl: null, paymentLinkExpiresAt: null },
      });
    });
  });
});
