import { ForbiddenException } from '../common/exceptions/app.exceptions';
import { BillingService } from './billing.service';

jest.mock('../config', () => ({ envs: {} }));
jest.mock('./prisma/generated/client', () => ({ PrismaClient: class {} }));

describe('BillingService (Facade)', () => {
  let service: BillingService;
  let mockPlans: any;
  let mockSubscriptions: any;
  let mockInvoicing: any;
  let mockPayments: any;

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

  const supervisorActor = {
    userId: 'sup-1',
    tenantId: 'tenant-1',
    role: 'supervisor',
  };

  beforeEach(() => {
    mockPlans = {
      listPlans: jest.fn().mockResolvedValue([]),
      updatePlan: jest.fn().mockResolvedValue({}),
    };
    mockSubscriptions = {
      getSubscription: jest.fn().mockResolvedValue({}),
      changePlan: jest.fn().mockResolvedValue({}),
      cancelSubscription: jest.fn().mockResolvedValue({}),
      cancelUndo: jest.fn().mockResolvedValue({}),
      resubscribe: jest.fn().mockResolvedValue({}),
      adminListSubscriptions: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      adminExtendTrial: jest.fn().mockResolvedValue({}),
    };
    mockInvoicing = {
      listInvoices: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getInvoice: jest.fn().mockResolvedValue({}),
      adminVoidInvoice: jest.fn().mockResolvedValue({}),
      adminIssueInvoice: jest.fn().mockResolvedValue({}),
      adminSetFiscalReceipt: jest.fn().mockResolvedValue({}),
    };
    mockPayments = {
      getPaymentLink: jest.fn().mockResolvedValue({ url: 'http://test', expiresAt: '2026-10-25' }),
      handleWebhook: jest.fn().mockResolvedValue({ ok: true }),
      adminRegisterPayment: jest.fn().mockResolvedValue({ id: 'p1', status: 'approved' }),
    };

    service = new BillingService(
      mockPlans,
      mockSubscriptions,
      mockInvoicing,
      mockPayments,
    );
  });

  describe('role checks', () => {
    it('blocks supervisor from tenant billing routes with 403', async () => {
      await expect(service.subscriptionGet(supervisorActor)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.subscriptionChangePlan(supervisorActor, 'pro'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks platform_admin from tenant billing routes with 403', async () => {
      await expect(service.subscriptionGet(adminActor)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('blocks tenant roles from admin routes with 403', async () => {
      await expect(
        service.adminSubscriptionList(tenantActor),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.adminInvoiceVoid(tenantActor, 'inv-1', 'reason'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delegation', () => {
    it('delegates tenant operations to sub-services', async () => {
      await service.planList(tenantActor);
      expect(mockPlans.listPlans).toHaveBeenCalled();

      await service.subscriptionGet(tenantActor);
      expect(mockSubscriptions.getSubscription).toHaveBeenCalledWith(tenantActor);

      await service.subscriptionChangePlan(tenantActor, 'pro');
      expect(mockSubscriptions.changePlan).toHaveBeenCalledWith(tenantActor, 'pro');

      await service.subscriptionCancel(tenantActor);
      expect(mockSubscriptions.cancelSubscription).toHaveBeenCalledWith(tenantActor);

      await service.subscriptionCancelUndo(tenantActor);
      expect(mockSubscriptions.cancelUndo).toHaveBeenCalledWith(tenantActor);

      await service.subscriptionResubscribe(tenantActor, 'pro');
      expect(mockSubscriptions.resubscribe).toHaveBeenCalledWith(tenantActor, 'pro');

      await service.invoiceList(tenantActor);
      expect(mockInvoicing.listInvoices).toHaveBeenCalled();

      await service.invoiceGet(tenantActor, 'inv-1');
      expect(mockInvoicing.getInvoice).toHaveBeenCalledWith(tenantActor, 'inv-1');

      await service.invoicePaymentLink(tenantActor, 'inv-1');
      expect(mockPayments.getPaymentLink).toHaveBeenCalledWith(tenantActor, 'inv-1');
    });

    it('delegates platform admin operations to sub-services', async () => {
      await service.adminPlanUpdate(adminActor, 'pro', '150000');
      expect(mockPlans.updatePlan).toHaveBeenCalled();

      await service.adminSubscriptionList(adminActor);
      expect(mockSubscriptions.adminListSubscriptions).toHaveBeenCalled();

      await service.adminSubscriptionExtendTrial(adminActor, 't-1', '2026-11-01');
      expect(mockSubscriptions.adminExtendTrial).toHaveBeenCalled();

      await service.adminInvoiceList(adminActor, 't-1');
      expect(mockInvoicing.listInvoices).toHaveBeenCalled();

      await service.adminInvoiceVoid(adminActor, 'inv-1', 'reason');
      expect(mockInvoicing.adminVoidInvoice).toHaveBeenCalled();

      await service.adminInvoiceIssue(adminActor, 't-1', '2026-10');
      expect(mockInvoicing.adminIssueInvoice).toHaveBeenCalled();

      await service.adminInvoiceSetFiscalReceipt(adminActor, 'inv-1', 'FC-1');
      expect(mockInvoicing.adminSetFiscalReceipt).toHaveBeenCalled();

      await service.adminPaymentRegister(adminActor, 'inv-1', '121000', '2026-10-15', 'REF-1');
      expect(mockPayments.adminRegisterPayment).toHaveBeenCalled();
    });

    it('delegates webhook directly to payments service', async () => {
      await service.webhookMercadopago({}, '{}');
      expect(mockPayments.handleWebhook).toHaveBeenCalled();
    });
  });
});
