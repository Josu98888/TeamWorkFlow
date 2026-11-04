import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CLOCK_SERVICE, type ClockService } from '../common/clock.service';
import { BillingEventsService } from './billing-events.service';
import {
  ConsumedEventProcessor,
  type ConsumedEventContext,
  type PostCommitEffect,
} from './consumed-event.processor';
import { CONSUMED_SUBJECTS } from './consumed-events';

const TRIAL_DAYS = 14;

@Injectable()
export class TenantCreatedHandler implements OnModuleInit {
  constructor(
    private readonly processor: ConsumedEventProcessor,
    private readonly events: BillingEventsService,
    @Inject(CLOCK_SERVICE) private readonly clock: ClockService,
  ) {}

  onModuleInit(): void {
    this.processor.register({
      filter: CONSUMED_SUBJECTS.authTenantCreated,
      handle: (context) => this.apply(context),
    });
  }

  async apply({
    tx,
    tenantId,
  }: ConsumedEventContext): Promise<PostCommitEffect[]> {
    const existing = await tx.subscription.findUnique({
      where: { tenantId },
    });
    if (existing) {
      return [];
    }

    const now = this.clock.now();
    const trialEndsAt = new Date(
      now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
    );

    await tx.subscription.create({
      data: {
        tenantId,
        plan: 'PRO',
        status: 'TRIAL',
        trialEndsAt,
      },
    });

    return [
      async () => {
        await this.events.publish({
          tenantId,
          event: 'subscription_created',
          payload: {
            plan: 'pro',
            features: {
              tasks: true,
              alerts: true,
              tower: true,
            },
            status: 'trial',
            trialEndsAt: trialEndsAt.toISOString(),
          },
        });
      },
    ];
  }
}
