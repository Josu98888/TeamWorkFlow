export interface ProviderPaymentDetails {
  id: string;
  status: 'approved' | 'rejected' | 'in_process' | 'other';
  amount: string;
  currency: string;
  externalReference: string;
  paidAt: Date;
}

export interface WebhookValidationResult {
  isValid: boolean;
  notificationId: string;
  paymentId?: string;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentProvider {
  createPaymentLink(invoice: {
    id: string;
    total: { toFixed(decimals: number): string } | string;
    dueDate: Date;
  }): Promise<{ url: string; expiresAt: Date }>;

  getPayment(paymentId: string): Promise<ProviderPaymentDetails>;

  searchPaymentsByReference(
    invoiceId: string,
  ): Promise<ProviderPaymentDetails[]>;

  validateWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | string,
  ): Promise<WebhookValidationResult>;
}
