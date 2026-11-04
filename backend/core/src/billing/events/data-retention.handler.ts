import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  ConsumedEventProcessor,
  type ConsumedEventContext,
  type PostCommitEffect,
} from './consumed-event.processor';
import { CONSUMED_SUBJECTS } from './consumed-events';

@Injectable()
export class DataRetentionHandler implements OnModuleInit {
  constructor(private readonly processor: ConsumedEventProcessor) {}

  onModuleInit(): void {
    this.processor.register({
      filter: CONSUMED_SUBJECTS.billingDataRetentionExpired,
      handle: (context) => this.apply(context),
    });
  }

  async apply({
    tx,
    tenantId,
  }: ConsumedEventContext): Promise<PostCommitEffect[]> {
    // Delete transient plan changes for tenant
    await tx.subscriptionPlanChange.deleteMany({
      where: { tenantId },
    });

    // Clear payment links from invoices
    await tx.invoice.updateMany({
      where: { tenantId },
      data: {
        paymentLinkUrl: null,
        paymentLinkExpiresAt: null,
      },
    });

    return [];
  }
}
