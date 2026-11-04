import { Decimal } from '@prisma/client/runtime/client';
import {
  ForbiddenException,
  InvalidWebhookSignatureException,
  InvoiceNotPayableException,
} from '../../common/exceptions/app.exceptions';
import { TestClockService } from '../common/clock.service';
import { BILLING_EVENTS } from '../events/billing.events';
import { FakePaymentProviderService } from './fake-payment-provider.service';
import { PaymentsService } from './payments.service';
import type { BillingEventsService } from '../events/billing-events.service';
import type { BillingPrismaService } from '../prisma/prisma.service';

jest.mock('../../config', () => ({
  envs: {
    graceDays: 7,
    appUrl: 'http://localhost:3002',
  },
}));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockPrisma: any;
  let mockEvents: any;
  let fakeProvider: FakePaymentProviderService;
  let clock: TestClockService;

  const tenantActor = {
    userId: 'owner-1',
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
    fakeProvider = new FakePaymentProviderService();
    mockPrisma = {
      invoice: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      webhookNotification: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      subscription: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    mockEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    service = new PaymentsService(
      mockPrisma as unknown as BillingPrismaService,
      mockEvents as unknown as BillingEventsService,
      fakeProvider,
      clock,
    );
  });

  describe('getPaymentLink', () => {
    it('returns existing link if still valid', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        tenantId: 'tenant-1',
        status: 'ISSUED',
        paymentLinkUrl: 'http://link.test',
        paymentLinkExpiresAt: new Date('2026-10-25T00:00:00.000Z'),
      });

      const result = await service.getPaymentLink(tenantActor, 'inv-1');

      expect(result.url).toBe('http://link.test');
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('generates new link if previous one expired', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        tenantId: 'tenant-1',
        status: 'ISSUED',
        total: new Decimal('121000.00'),
        dueDate: new Date('2026-10-20T00:00:00.000Z'),
        paymentLinkUrl: 'http://old.test',
        paymentLinkExpiresAt: new Date('2026-10-10T00:00:00.000Z'), // expired
      });
      mockPrisma.invoice.update.mockResolvedValue({});

      const result = await service.getPaymentLink(tenantActor, 'inv-1');

      expect(result.url).toContain('/billing/fake-pay/inv-1');
      expect(mockPrisma.invoice.update).toHaveBeenCalled();
    });

    it('throws InvoiceNotPayableException if invoice is already PAID or VOID', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-paid',
        tenantId: 'tenant-1',
        status: 'PAID',
      });

      await expect(
        service.getPaymentLink(tenantActor, 'inv-paid'),
      ).rejects.toThrow(InvoiceNotPayableException);
    });
  });

  describe('handleWebhook', () => {
    it('rejects invalid signature with InvalidWebhookSignatureException (401)', async () => {
      await expect(
        service.handleWebhook({ 'x-test-signature': 'invalid' }, '{}'),
      ).rejects.toThrow(InvalidWebhookSignatureException);
    });

    it('skips duplicate webhook notification idempotently', async () => {
      mockPrisma.webhookNotification.findUnique.mockResolvedValueOnce({
        id: 'notif-1',
      });

      const res = await service.handleWebhook(
        { 'x-test-signature': 'valid' },
        JSON.stringify({ id: 'notif-1' }),
      );

      expect(res.ok).toBe(true);
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });

    it('processes matching approved payment, marks invoice PAID, and emits payment_received', async () => {
      fakeProvider.registerMockPayment({
        id: 'pay-123',
        status: 'approved',
        amount: '121000.00',
        currency: 'ARS',
        externalReference: 'inv-1',
        paidAt: new Date('2026-10-15T12:00:00.000Z'),
      });

      mockPrisma.webhookNotification.findUnique.mockResolvedValueOnce(null);
      mockPrisma.webhookNotification.create.mockResolvedValue({});
      mockPrisma.payment.findUnique.mockResolvedValueOnce(null); // not yet recorded
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        tenantId: 'tenant-1',
        total: new Decimal('121000.00'),
        status: 'ISSUED',
      });
      mockPrisma.payment.create.mockResolvedValue({});
      mockPrisma.invoice.update.mockResolvedValue({});
      mockPrisma.invoice.findFirst.mockResolvedValueOnce(null); // no other overdue
      mockPrisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        status: 'PAST_DUE',
      });
      mockPrisma.subscription.update.mockResolvedValue({});

      const res = await service.handleWebhook(
        { 'x-test-signature': 'valid' },
        JSON.stringify({ id: 'notif-new', data: { id: 'pay-123' } }),
      );

      expect(res.ok).toBe(true);
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'APPROVED',
          }),
        }),
      );
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
      expect(mockEvents.publish).toHaveBeenCalledWith(
        'tenant-1',
        BILLING_EVENTS.paymentReceived,
        expect.objectContaining({ invoiceId: 'inv-1' }),
      );
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'ACTIVE' },
      });
    });

    it('records payment as NEEDS_REVIEW if amount does not match invoice total', async () => {
      fakeProvider.registerMockPayment({
        id: 'pay-partial',
        status: 'approved',
        amount: '50000.00', // partial
        currency: 'ARS',
        externalReference: 'inv-1',
        paidAt: new Date('2026-10-15T12:00:00.000Z'),
      });

      mockPrisma.webhookNotification.findUnique.mockResolvedValueOnce(null);
      mockPrisma.webhookNotification.create.mockResolvedValue({});
      mockPrisma.payment.findUnique.mockResolvedValueOnce(null);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        tenantId: 'tenant-1',
        total: new Decimal('121000.00'),
        status: 'ISSUED',
      });
      mockPrisma.payment.create.mockResolvedValue({});

      await service.handleWebhook(
        { 'x-test-signature': 'valid' },
        JSON.stringify({ id: 'notif-2', data: { id: 'pay-partial' } }),
      );

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'NEEDS_REVIEW',
          }),
        }),
      );
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });
  });

  describe('adminRegisterPayment', () => {
    it('rejects non-platform-admin with 403 ForbiddenException', async () => {
      await expect(
        service.adminRegisterPayment(tenantActor, {
          invoiceId: 'inv-1',
          amount: '121000.00',
          paidAt: new Date(),
          reference: 'TX-123',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('registers manual bank transfer and approves payment if amount matches', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        tenantId: 'tenant-1',
        total: new Decimal('121000.00'),
      });
      mockPrisma.payment.create.mockResolvedValueOnce({
        id: 'pay-man-1',
        status: 'APPROVED',
      });
      mockPrisma.invoice.update.mockResolvedValue({});
      mockPrisma.invoice.findFirst.mockResolvedValueOnce(null);

      const result = await service.adminRegisterPayment(adminActor, {
        invoiceId: 'inv-1',
        amount: '121000.00',
        paidAt: new Date(),
        reference: 'BANK-TRANSFER-999',
      });

      expect(result.status).toBe('approved');
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });
  });

  describe('reconciliation', () => {
    it('reconciles unpaid invoices by searching provider', async () => {
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        { id: 'inv-unpaid-1' },
      ]);
      fakeProvider.registerMockPayment({
        id: 'pay-found',
        status: 'approved',
        amount: '121000.00',
        currency: 'ARS',
        externalReference: 'inv-unpaid-1',
        paidAt: new Date(),
      });
      mockPrisma.payment.findUnique.mockResolvedValueOnce(null);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-unpaid-1',
        tenantId: 'tenant-1',
        total: new Decimal('121000.00'),
      });
      mockPrisma.payment.create.mockResolvedValue({});
      mockPrisma.invoice.update.mockResolvedValue({});
      mockPrisma.invoice.findFirst.mockResolvedValueOnce(null);

      const count = await service.reconcileUnpaidInvoices();

      expect(count).toBe(1);
    });
  });
});
