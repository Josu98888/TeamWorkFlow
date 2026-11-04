jest.mock('../../config', () => ({
  envs: {
    paymentProvider: 'fake',
  },
}));

jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
}));

import type { VerifiedActor } from '../../auth/verified-actor';
import { BillingController } from './billing.controller';
import type { BillingService } from '../billing.service';

describe('BillingController', () => {
  let controller: BillingController;
  let mockBillingService: any;

  const actor: VerifiedActor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'owner',
    siteIds: [],
    tenantStatus: 'active',
    plan: 'pro',
    features: { tasks: true, alerts: true, tower: true },
  };

  beforeEach(() => {
    mockBillingService = {
      planList: jest.fn().mockResolvedValue([]),
      subscriptionGet: jest.fn().mockResolvedValue({}),
      subscriptionChangePlan: jest.fn().mockResolvedValue({}),
      subscriptionCancel: jest.fn().mockResolvedValue({}),
      subscriptionCancelUndo: jest.fn().mockResolvedValue({}),
      subscriptionResubscribe: jest.fn().mockResolvedValue({}),
      invoiceList: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      invoiceGet: jest.fn().mockResolvedValue({}),
      invoicePaymentLink: jest.fn().mockResolvedValue({ url: 'http://pay', expiresAt: '2026-10-25' }),
    };

    controller = new BillingController(mockBillingService as unknown as BillingService);
  });

  it('delegates listPlans to service', async () => {
    await controller.listPlans(actor);
    expect(mockBillingService.planList).toHaveBeenCalledWith(actor);
  });

  it('delegates getSubscription to service', async () => {
    await controller.getSubscription(actor);
    expect(mockBillingService.subscriptionGet).toHaveBeenCalledWith(actor);
  });

  it('delegates changePlan to service', async () => {
    await controller.changePlan(actor, { plan: 'pro' });
    expect(mockBillingService.subscriptionChangePlan).toHaveBeenCalledWith(actor, 'pro');
  });

  it('delegates cancelSubscription to service', async () => {
    await controller.cancelSubscription(actor);
    expect(mockBillingService.subscriptionCancel).toHaveBeenCalledWith(actor);
  });

  it('delegates cancelUndo to service', async () => {
    await controller.cancelUndo(actor);
    expect(mockBillingService.subscriptionCancelUndo).toHaveBeenCalledWith(actor);
  });

  it('delegates resubscribe to service', async () => {
    await controller.resubscribe(actor, { plan: 'pro' });
    expect(mockBillingService.subscriptionResubscribe).toHaveBeenCalledWith(actor, 'pro');
  });

  it('delegates listInvoices to service with query pagination', async () => {
    await controller.listInvoices(actor, { page: 2, pageSize: 10, period: '2026-09' });
    expect(mockBillingService.invoiceList).toHaveBeenCalledWith(
      actor,
      { status: undefined, period: '2026-09' },
      2,
      10,
    );
  });

  it('delegates getInvoice to service', async () => {
    await controller.getInvoice(actor, { invoiceId: '0199b7e0-0000-7000-8000-000000000001' });
    expect(mockBillingService.invoiceGet).toHaveBeenCalledWith(
      actor,
      '0199b7e0-0000-7000-8000-000000000001',
    );
  });

  it('delegates getPaymentLink to service', async () => {
    await controller.getPaymentLink(actor, { invoiceId: '0199b7e0-0000-7000-8000-000000000001' });
    expect(mockBillingService.invoicePaymentLink).toHaveBeenCalledWith(
      actor,
      '0199b7e0-0000-7000-8000-000000000001',
    );
  });
});
