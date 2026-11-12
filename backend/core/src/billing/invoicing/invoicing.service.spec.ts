import { Decimal } from '@prisma/client/runtime/client';
import {
  InvoiceExistsException,
  InvoiceNotFoundException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import { TestClockService } from '../common/clock.service';
import { BILLING_EVENTS } from '../events/billing.events';
import { InvoicingService } from './invoicing.service';
import type { BillingEventsService } from '../events/billing-events.service';
import type { BillingPrismaService } from '../prisma/prisma.service';

jest.mock('../../config', () => ({
  envs: {
    vatPercent: 21,
    dueDays: 10,
    billingTz: 'America/Argentina/Buenos_Aires',
  },
}));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

describe('InvoicingService', () => {
  let service: InvoicingService;
  let mockPrisma: any;
  let mockEvents: any;
  let clock: TestClockService;

  const adminActor = {
    userId: 'admin-1',
    tenantId: null,
    role: 'platform_admin',
  };

  const tenantActor = {
    userId: 'owner-1',
    tenantId: 'tenant-1',
    role: 'owner',
  };

  beforeEach(() => {
    clock = new TestClockService('2026-11-01T03:00:00.000Z');
    mockPrisma = {
      subscription: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      invoice: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      plan: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(mockPrisma);
        }
        return Promise.all(cb);
      }),
    };
    mockEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
      publishNotification: jest.fn().mockResolvedValue(undefined),
    };
    service = new InvoicingService(
      mockPrisma as unknown as BillingPrismaService,
      mockEvents as unknown as BillingEventsService,
      clock,
    );
  });

  describe('closeMonth', () => {
    it('creates invoice with lines and emits events for billable subscription', async () => {
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        {
          id: 'sub-1',
          tenantId: 'tenant-1',
          plan: 'PRO',
          status: 'ACTIVE',
          trialEndsAt: null,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          endedAt: null,
          nextPlan: null,
          cancelAtPeriodEnd: false,
          planChanges: [],
        },
      ]);
      mockPrisma.invoice.findFirst.mockResolvedValueOnce(null);
      mockPrisma.plan.findUnique.mockResolvedValueOnce({
        code: 'PRO',
        name: 'Pro',
        monthlyPrice: new Decimal('100000.00'),
        features: { tasks: true, alerts: true, tower: true },
      });

      const fakeInvoice = {
        id: 'inv-1',
        tenantId: 'tenant-1',
        subscriptionId: 'sub-1',
        period: '2026-10',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-10-31T23:59:59.999Z'),
        plan: 'PRO',
        billableDays: 31,
        daysInPeriod: 31,
        subtotal: new Decimal('100000.00'),
        vatPercent: new Decimal('21.00'),
        vatAmount: new Decimal('21000.00'),
        total: new Decimal('121000.00'),
        currency: 'ARS',
        status: 'ISSUED',
        issuedAt: new Date('2026-11-01T03:00:00.000Z'),
        dueDate: new Date('2026-11-11T03:00:00.000Z'),
        paidAt: null,
        voidedAt: null,
        voidReason: null,
        voidedByUserId: null,
        fiscalReceiptNumber: null,
        paymentLinkUrl: null,
        paymentLinkExpiresAt: null,
        lines: [
          {
            id: 'line-1',
            kind: 'PLAN',
            description: 'Plan Pro',
            quantity: 1,
            unitPrice: new Decimal('100000.00'),
            amount: new Decimal('100000.00'),
          },
          {
            id: 'line-2',
            kind: 'VAT',
            description: 'IVA',
            quantity: 1,
            unitPrice: new Decimal('21000.00'),
            amount: new Decimal('21000.00'),
          },
        ],
        payments: [],
        createdAt: new Date('2026-11-01T03:00:00.000Z'),
        updatedAt: new Date('2026-11-01T03:00:00.000Z'),
      };
      mockPrisma.invoice.create.mockResolvedValueOnce(fakeInvoice);

      const result = await service.closeMonth('2026-10');

      expect(result).toHaveLength(1);
      expect(result[0].total).toBe('121000.00');
      expect(result[0].subtotal).toBe('100000.00');
      expect(result[0].vatAmount).toBe('21000.00');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        'tenant-1',
        BILLING_EVENTS.invoiceIssued,
        expect.objectContaining({
          invoiceId: 'inv-1',
          total: '121000.00',
        }),
      );
      expect(mockEvents.publishNotification).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          templateCode: 'billing_invoice_issued',
        }),
      );
    });

    it('skips issuing if invoice already exists for period (idempotent)', async () => {
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        {
          id: 'sub-1',
          tenantId: 'tenant-1',
          plan: 'PRO',
          status: 'ACTIVE',
          trialEndsAt: null,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          endedAt: null,
          nextPlan: null,
          cancelAtPeriodEnd: false,
          planChanges: [],
        },
      ]);
      mockPrisma.invoice.findFirst.mockResolvedValueOnce({
        id: 'existing-inv',
      });

      const result = await service.closeMonth('2026-10');

      expect(result).toHaveLength(0);
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('applies pending downgrade and cancellation after invoice close', async () => {
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        {
          id: 'sub-1',
          tenantId: 'tenant-1',
          plan: 'PRO',
          status: 'ACTIVE',
          trialEndsAt: null,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          endedAt: null,
          nextPlan: 'BASIC',
          cancelAtPeriodEnd: true,
          planChanges: [],
        },
      ]);
      mockPrisma.invoice.findFirst.mockResolvedValueOnce({ id: 'inv-already' });
      mockPrisma.plan.findUnique.mockResolvedValueOnce({
        code: 'BASIC',
        features: { tasks: false },
      });
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.closeMonth('2026-10');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { plan: 'BASIC', nextPlan: null },
      });
      expect(mockEvents.publish).toHaveBeenCalledWith(
        'tenant-1',
        BILLING_EVENTS.planChanged,
        expect.any(Object),
      );
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
      expect(mockEvents.publish).toHaveBeenCalledWith(
        'tenant-1',
        BILLING_EVENTS.subscriptionCancelled,
        expect.any(Object),
      );
    });
  });

  describe('admin operations', () => {
    it('adminIssueInvoice throws InvoiceExistsException if invoice already exists', async () => {
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        {
          id: 'sub-1',
          tenantId: 'tenant-1',
          plan: 'PRO',
          status: 'ACTIVE',
          trialEndsAt: null,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          endedAt: null,
          planChanges: [],
        },
      ]);
      mockPrisma.invoice.findFirst.mockResolvedValueOnce({ id: 'exists' });

      await expect(
        service.adminIssueInvoice(adminActor, 'tenant-1', '2026-10'),
      ).rejects.toThrow(InvoiceExistsException);
    });

    it('adminVoidInvoice updates status to VOID with mandatory reason', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        plan: 'PRO',
        status: 'ISSUED',
        total: new Decimal('121000.00'),
        subtotal: new Decimal('100000.00'),
        vatPercent: new Decimal('21.00'),
        vatAmount: new Decimal('21000.00'),
        periodStart: new Date('2026-10-01'),
        periodEnd: new Date('2026-10-31'),
        issuedAt: new Date('2026-11-01'),
        dueDate: new Date('2026-11-11'),
      });

      mockPrisma.invoice.update.mockResolvedValueOnce({
        id: 'inv-1',
        plan: 'PRO',
        status: 'VOID',
        voidReason: 'Billing mistake',
        voidedByUserId: 'admin-1',
        total: new Decimal('121000.00'),
        subtotal: new Decimal('100000.00'),
        vatPercent: new Decimal('21.00'),
        vatAmount: new Decimal('21000.00'),
        periodStart: new Date('2026-10-01'),
        periodEnd: new Date('2026-10-31'),
        issuedAt: new Date('2026-11-01'),
        dueDate: new Date('2026-11-11'),
        createdAt: new Date('2026-11-01'),
        updatedAt: new Date('2026-11-01'),
      });

      const voided = await service.adminVoidInvoice(
        adminActor,
        'inv-1',
        'Billing mistake',
      );

      expect(voided.status).toBe('void');
      expect(voided.voidReason).toBe('Billing mistake');
    });

    it('adminVoidInvoice rejects empty reason with ValidationException', async () => {
      await expect(
        service.adminVoidInvoice(adminActor, 'inv-1', ''),
      ).rejects.toThrow(ValidationException);
    });

    it('adminSetFiscalReceipt updates fiscalReceiptNumber without altering totals', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        plan: 'PRO',
        total: new Decimal('1000.00'),
      });

      mockPrisma.invoice.update.mockResolvedValueOnce({
        id: 'inv-1',
        plan: 'PRO',
        fiscalReceiptNumber: 'FC-A-0001-00001234',
        status: 'ISSUED',
        total: new Decimal('1000.00'),
        subtotal: new Decimal('826.45'),
        vatPercent: new Decimal('21.00'),
        vatAmount: new Decimal('173.55'),
        periodStart: new Date('2026-10-01'),
        periodEnd: new Date('2026-10-31'),
        issuedAt: new Date('2026-11-01'),
        dueDate: new Date('2026-11-11'),
        createdAt: new Date('2026-11-01'),
        updatedAt: new Date('2026-11-01'),
      });

      const updated = await service.adminSetFiscalReceipt(
        adminActor,
        'inv-1',
        'FC-A-0001-00001234',
      );

      expect(updated.fiscalReceiptNumber).toBe('FC-A-0001-00001234');
      expect(updated.total).toBe('1000.00');
    });
  });

  describe('queries and isolation', () => {
    it('getInvoice throws 404 if actor accesses other tenant invoice', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-other',
        tenantId: 'tenant-other',
      });

      await expect(service.getInvoice(tenantActor, 'inv-other')).rejects.toThrow(
        InvoiceNotFoundException,
      );
    });
  });
});
