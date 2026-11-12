import {
  ForbiddenException,
  InvalidPlanChangeException,
  InvalidSubscriptionTransitionException,
  NoPendingCancellationException,
  SubscriptionNotFoundException,
} from '../../common/exceptions/app.exceptions';
import { TestClockService } from '../common/clock.service';
import { BILLING_EVENTS } from '../events/billing.events';
import { SubscriptionsService } from './subscriptions.service';
import type { BillingEventsService } from '../events/billing-events.service';
import type { BillingPrismaService } from '../prisma/prisma.service';

jest.mock('../../config', () => ({ envs: {} }));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let mockPrisma: any;
  let mockEvents: any;
  let clock: TestClockService;

  const tenantActor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'owner',
  };

  const adminActor = {
    userId: 'admin-1',
    tenantId: null,
    role: 'platform_admin',
  };

  beforeEach(() => {
    clock = new TestClockService('2026-10-15T12:00:00.000Z');
    mockPrisma = {
      subscription: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      plan: {
        findUnique: jest.fn(),
      },
      subscriptionPlanChange: {
        create: jest.fn(),
      },
      $transaction: jest.fn((promises) => Promise.all(promises)),
    };
    mockEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    service = new SubscriptionsService(
      mockPrisma as unknown as BillingPrismaService,
      mockEvents as unknown as BillingEventsService,
      clock,
    );
  });

  describe('getSubscription', () => {
    it('returns subscription with full features for actor tenant', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
        trialEndsAt: null,
        nextPlan: null,
        cancelAtPeriodEnd: false,
        endedAt: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
        planRef: {
          features: { tasks: true, alerts: true, tower: true },
        },
      });

      const sub = await service.getSubscription(tenantActor);

      expect(sub.tenantId).toBe('tenant-1');
      expect(sub.plan).toBe('pro');
      expect(sub.status).toBe('active');
      expect(sub.features).toEqual({ tasks: true, alerts: true, tower: true });
    });

    it('throws SubscriptionNotFoundException if no subscription exists', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await expect(service.getSubscription(tenantActor)).rejects.toThrow(
        SubscriptionNotFoundException,
      );
    });
  });

  describe('changePlan', () => {
    it('upgrades to PRO immediately, records change, and emits plan_changed', async () => {
      mockPrisma.plan.findUnique.mockResolvedValueOnce({
        code: 'PRO',
        name: 'Pro',
        isActive: true,
        features: { tasks: true, alerts: true, tower: true },
      });

      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'BASIC',
        status: 'ACTIVE',
      });

      mockPrisma.subscription.update.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
        trialEndsAt: null,
        nextPlan: null,
        cancelAtPeriodEnd: false,
        endedAt: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-15T12:00:00.000Z'),
        planRef: {
          features: { tasks: true, alerts: true, tower: true },
        },
      });

      const updated = await service.changePlan(tenantActor, 'pro');

      expect(updated.plan).toBe('pro');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        'tenant-1',
        BILLING_EVENTS.planChanged,
        expect.objectContaining({
          plan: 'pro',
          previousPlan: 'basic',
          effectiveAt: '2026-10-15T12:00:00.000Z',
        }),
      );
    });

    it('downgrades to BASIC by setting nextPlan without immediate plan change', async () => {
      mockPrisma.plan.findUnique.mockResolvedValueOnce({
        code: 'BASIC',
        name: 'Basic',
        isActive: true,
        features: { tasks: false, alerts: false, tower: false },
      });

      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
      });

      mockPrisma.subscription.update.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
        trialEndsAt: null,
        nextPlan: 'BASIC',
        cancelAtPeriodEnd: false,
        endedAt: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-15T12:00:00.000Z'),
        planRef: {
          features: { tasks: true, alerts: true, tower: true },
        },
      });

      const updated = await service.changePlan(tenantActor, 'basic');

      expect(updated.plan).toBe('pro');
      expect(updated.nextPlan).toBe('basic');
      expect(mockEvents.publish).not.toHaveBeenCalled();
    });

    it('throws InvalidPlanChangeException if same plan is selected', async () => {
      mockPrisma.plan.findUnique.mockResolvedValueOnce({
        code: 'PRO',
        isActive: true,
      });

      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
      });

      await expect(service.changePlan(tenantActor, 'pro')).rejects.toThrow(
        InvalidPlanChangeException,
      );
    });
  });

  describe('cancel and cancel-undo', () => {
    it('cancelSubscription sets cancelAtPeriodEnd without immediate cancellation', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
      });

      mockPrisma.subscription.update.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
        trialEndsAt: null,
        nextPlan: null,
        cancelAtPeriodEnd: true,
        endedAt: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-15T12:00:00.000Z'),
        planRef: { features: {} },
      });

      const result = await service.cancelSubscription(tenantActor);

      expect(result.cancelAtPeriodEnd).toBe(true);
      expect(result.status).toBe('active');
    });

    it('cancelUndo clears cancelAtPeriodEnd flag', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
      });

      mockPrisma.subscription.update.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
        trialEndsAt: null,
        nextPlan: null,
        cancelAtPeriodEnd: false,
        endedAt: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-15T12:00:00.000Z'),
        planRef: { features: {} },
      });

      const result = await service.cancelUndo(tenantActor);

      expect(result.cancelAtPeriodEnd).toBe(false);
    });

    it('cancelUndo throws NoPendingCancellationException when not cancelling', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      });

      await expect(service.cancelUndo(tenantActor)).rejects.toThrow(
        NoPendingCancellationException,
      );
    });
  });

  describe('resubscribe', () => {
    it('creates active subscription and emits events when tenant has cancelled subscription', async () => {
      mockPrisma.subscription.findFirst
        .mockResolvedValueOnce(null) // no active sub
        .mockResolvedValueOnce({
          id: 'old-sub',
          tenantId: 'tenant-1',
          plan: 'BASIC',
          status: 'CANCELLED',
        });

      mockPrisma.plan.findUnique.mockResolvedValueOnce({
        code: 'PRO',
        isActive: true,
        features: { tasks: true, alerts: true, tower: true },
      });

      mockPrisma.subscription.create.mockResolvedValueOnce({
        id: 'new-sub',
        tenantId: 'tenant-1',
        plan: 'PRO',
        status: 'ACTIVE',
        trialEndsAt: null,
        nextPlan: null,
        cancelAtPeriodEnd: false,
        endedAt: null,
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
        updatedAt: new Date('2026-10-15T12:00:00.000Z'),
        planRef: { features: { tasks: true, alerts: true, tower: true } },
      });

      const result = await service.resubscribe(tenantActor, 'pro');

      expect(result.status).toBe('active');
      expect(result.plan).toBe('pro');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        'tenant-1',
        BILLING_EVENTS.planChanged,
        expect.any(Object),
      );
      expect(mockEvents.publish).toHaveBeenCalledWith(
        'tenant-1',
        BILLING_EVENTS.subscriptionReactivated,
        expect.any(Object),
      );
    });

    it('rejects resubscribe if tenant already has a non-cancelled subscription', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'active-sub',
        status: 'ACTIVE',
      });

      await expect(service.resubscribe(tenantActor, 'pro')).rejects.toThrow(
        InvalidSubscriptionTransitionException,
      );
    });
  });

  describe('platform admin operations', () => {
    it('adminExtendTrial extends trial for subscriptions in TRIAL', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-trial',
        tenantId: 'tenant-2',
        status: 'TRIAL',
        trialEndsAt: new Date('2026-10-20T00:00:00.000Z'),
      });

      const newDate = new Date('2026-11-01T00:00:00.000Z');
      mockPrisma.subscription.update.mockResolvedValueOnce({
        id: 'sub-trial',
        tenantId: 'tenant-2',
        plan: 'PRO',
        status: 'TRIAL',
        trialEndsAt: newDate,
        nextPlan: null,
        cancelAtPeriodEnd: false,
        endedAt: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-15T12:00:00.000Z'),
        planRef: { features: {} },
      });

      const result = await service.adminExtendTrial(adminActor, 'tenant-2', newDate);

      expect(result.trialEndsAt).toBe(newDate.toISOString());
    });

    it('adminExtendTrial rejects non-trial subscription with 409', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-active',
        tenantId: 'tenant-2',
        status: 'ACTIVE',
      });

      await expect(
        service.adminExtendTrial(adminActor, 'tenant-2', '2026-11-01T00:00:00.000Z'),
      ).rejects.toThrow(InvalidSubscriptionTransitionException);
    });
  });

  describe('trial expiration', () => {
    it('transitions expired trials to ACTIVE', async () => {
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        { id: 'sub-1', tenantId: 'tenant-1' },
        { id: 'sub-2', tenantId: 'tenant-2' },
      ]);
      mockPrisma.subscription.update.mockResolvedValue({});

      const count = await service.expireTrials();

      expect(count).toBe(2);
      expect(mockPrisma.subscription.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'ACTIVE' },
      });
    });
  });
});
