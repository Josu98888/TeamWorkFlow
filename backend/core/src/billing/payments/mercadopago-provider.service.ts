import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PaymentProviderErrorException } from '../../common/exceptions/app.exceptions';
import { envs } from '../../config';
import type {
  PaymentProvider,
  ProviderPaymentDetails,
  WebhookValidationResult,
} from './payment-provider.interface';

@Injectable()
export class MercadoPagoProviderService implements PaymentProvider {
  private readonly logger = new Logger(MercadoPagoProviderService.name);

  async createPaymentLink(invoice: {
    id: string;
    total: { toFixed(decimals: number): string } | string;
    dueDate: Date;
  }): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(
      invoice.dueDate.getTime() + envs.graceDays * 24 * 60 * 60 * 1000,
    );
    const totalAmount =
      typeof invoice.total === 'string'
        ? Number(invoice.total)
        : Number(invoice.total.toFixed(2));

    try {
      const response = await fetch(
        'https://api.mercadopago.com/checkout/preferences',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${envs.mpAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items: [
              {
                id: invoice.id,
                title: 'Abono TeamWorkFlow',
                unit_price: totalAmount,
                quantity: 1,
                currency_id: 'ARS',
              },
            ],
            external_reference: invoice.id,
            expires: true,
            expiration_date_to: expiresAt.toISOString(),
            back_urls: {
              success: `${envs.appUrl}/billing/invoices/${invoice.id}?status=success`,
              failure: `${envs.appUrl}/billing/invoices/${invoice.id}?status=failure`,
              pending: `${envs.appUrl}/billing/invoices/${invoice.id}?status=pending`,
            },
            auto_return: 'approved',
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Mercado Pago preference creation failed: ${errorText}`);
        throw new PaymentProviderErrorException(
          'Failed to create payment link with Mercado Pago',
        );
      }

      const data = (await response.json()) as {
        init_point?: string;
        sandbox_init_point?: string;
      };

      const url = data.init_point ?? data.sandbox_init_point ?? '';
      return { url, expiresAt };
    } catch (error) {
      if (error instanceof PaymentProviderErrorException) {
        throw error;
      }
      this.logger.error('Mercado Pago network error on preference creation', error);
      throw new PaymentProviderErrorException();
    }
  }

  async getPayment(paymentId: string): Promise<ProviderPaymentDetails> {
    try {
      const response = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: {
            Authorization: `Bearer ${envs.mpAccessToken}`,
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Mercado Pago payment fetch failed: ${errorText}`);
        throw new PaymentProviderErrorException();
      }

      const data = (await response.json()) as {
        id: number | string;
        status: string;
        transaction_amount: number;
        currency_id: string;
        external_reference: string;
        date_approved?: string;
        date_created: string;
      };

      return {
        id: String(data.id),
        status:
          data.status === 'approved'
            ? 'approved'
            : data.status === 'rejected'
              ? 'rejected'
              : 'in_process',
        amount: data.transaction_amount.toFixed(2),
        currency: data.currency_id,
        externalReference: data.external_reference,
        paidAt: new Date(data.date_approved ?? data.date_created),
      };
    } catch (error) {
      if (error instanceof PaymentProviderErrorException) {
        throw error;
      }
      this.logger.error('Mercado Pago network error on payment fetch', error);
      throw new PaymentProviderErrorException();
    }
  }

  async searchPaymentsByReference(
    invoiceId: string,
  ): Promise<ProviderPaymentDetails[]> {
    try {
      const response = await fetch(
        `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(
          invoiceId,
        )}`,
        {
          headers: {
            Authorization: `Bearer ${envs.mpAccessToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new PaymentProviderErrorException();
      }

      const data = (await response.json()) as {
        results?: Array<{
          id: number | string;
          status: string;
          transaction_amount: number;
          currency_id: string;
          external_reference: string;
          date_approved?: string;
          date_created: string;
        }>;
      };

      return (data.results ?? []).map((p) => ({
        id: String(p.id),
        status:
          p.status === 'approved'
            ? 'approved'
            : p.status === 'rejected'
              ? 'rejected'
              : 'in_process',
        amount: p.transaction_amount.toFixed(2),
        currency: p.currency_id,
        externalReference: p.external_reference,
        paidAt: new Date(p.date_approved ?? p.date_created),
      }));
    } catch (error) {
      if (error instanceof PaymentProviderErrorException) {
        throw error;
      }
      this.logger.error('Mercado Pago network error on search payments', error);
      throw new PaymentProviderErrorException();
    }
  }

  async validateWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | string,
  ): Promise<WebhookValidationResult> {
    const rawSig = headers['x-signature'];
    const xSignature = Array.isArray(rawSig) ? rawSig[0] : rawSig;
    const rawReqId = headers['x-request-id'];
    const xRequestId = Array.isArray(rawReqId) ? rawReqId[0] : rawReqId;

    const bodyStr =
      typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    let notificationId = 'mp-' + Date.now();
    let paymentId: string | undefined;

    try {
      const json = JSON.parse(bodyStr);
      if (json.id) notificationId = String(json.id);
      if (json.data?.id) paymentId = String(json.data.id);
    } catch {
      // not JSON
    }

    if (!xSignature || !envs.mpWebhookSecret) {
      return { isValid: false, notificationId, paymentId };
    }

    // Parse ts and v1 from x-signature: "ts=123...,v1=abc..."
    const parts = xSignature.split(',').map((p) => p.trim());
    let ts: string | undefined;
    let v1: string | undefined;

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 'ts') ts = value;
      if (key === 'v1') v1 = value;
    }

    if (!ts || !v1) {
      return { isValid: false, notificationId, paymentId };
    }

    const dataId = paymentId ?? '';
    const manifest = `id:${dataId};request-id:${xRequestId ?? ''};ts:${ts};`;
    const hmac = createHmac('sha256', envs.mpWebhookSecret)
      .update(manifest)
      .digest('hex');

    const signatureBuffer = Buffer.from(v1, 'utf8');
    const hmacBuffer = Buffer.from(hmac, 'utf8');

    if (
      signatureBuffer.length !== hmacBuffer.length ||
      !timingSafeEqual(signatureBuffer, hmacBuffer)
    ) {
      return { isValid: false, notificationId, paymentId };
    }

    return {
      isValid: true,
      notificationId,
      paymentId,
    };
  }
}
