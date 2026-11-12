import { Injectable } from '@nestjs/common';
import { envs } from '../../config';
import type {
  PaymentProvider,
  ProviderPaymentDetails,
  WebhookValidationResult,
} from './payment-provider.interface';

@Injectable()
export class FakePaymentProviderService implements PaymentProvider {
  private readonly payments = new Map<string, ProviderPaymentDetails>();

  async createPaymentLink(invoice: {
    id: string;
    total: { toFixed(decimals: number): string } | string;
    dueDate: Date;
  }): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(
      invoice.dueDate.getTime() + envs.graceDays * 24 * 60 * 60 * 1000,
    );
    const url = `${envs.appUrl}/billing/fake-pay/${invoice.id}`;
    return { url, expiresAt };
  }

  async getPayment(paymentId: string): Promise<ProviderPaymentDetails> {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      return {
        id: paymentId,
        status: 'approved',
        amount: '121000.00',
        currency: 'ARS',
        externalReference: 'inv-test',
        paidAt: new Date(),
      };
    }
    return payment;
  }

  async searchPaymentsByReference(
    invoiceId: string,
  ): Promise<ProviderPaymentDetails[]> {
    const matches: ProviderPaymentDetails[] = [];
    for (const p of this.payments.values()) {
      if (p.externalReference === invoiceId) {
        matches.push(p);
      }
    }
    return matches;
  }

  async validateWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | string,
  ): Promise<WebhookValidationResult> {
    const sig = headers['x-test-signature'] ?? headers['x-signature'];
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    let notificationId = 'fake-notif-' + Date.now();
    let paymentId: string | undefined;

    try {
      const parsed = JSON.parse(bodyStr);
      if (parsed.id) notificationId = String(parsed.id);
      if (parsed.data?.id) paymentId = String(parsed.data.id);
    } catch {
      // not JSON
    }

    if (sig === 'invalid') {
      return { isValid: false, notificationId };
    }

    return {
      isValid: true,
      notificationId,
      paymentId: paymentId ?? 'fake-pay-123',
    };
  }

  // Test helper to mock provider payments
  registerMockPayment(payment: ProviderPaymentDetails) {
    this.payments.set(payment.id, payment);
  }
}
