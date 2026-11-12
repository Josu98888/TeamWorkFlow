import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ConsumedEventProcessor,
  PoisonEventError,
  type ConsumedEventContext,
} from '../consumed-event.processor';
import { CONSUMED_SUBJECTS } from '../consumers.constants';
import { TenantStateService } from '../../tenants/tenant-state.service';

@Injectable()
export class BillingConsumer implements OnModuleInit {
  private readonly logger = new Logger(BillingConsumer.name);

  constructor(
    private readonly processor: ConsumedEventProcessor,
    private readonly tenantState: TenantStateService,
  ) {}

  onModuleInit(): void {
    this.processor.register({
      filter: CONSUMED_SUBJECTS.SUBSCRIPTION_CREATED,
      handle: (ctx) => this.handleFeaturesUpdate(ctx),
    });

    this.processor.register({
      filter: CONSUMED_SUBJECTS.PLAN_CHANGED,
      handle: (ctx) => this.handleFeaturesUpdate(ctx),
    });

    this.processor.register({
      filter: CONSUMED_SUBJECTS.DATA_RETENTION_EXPIRED,
      handle: (ctx) => this.handleDataRetentionExpired(ctx),
    });
  }

  private async handleFeaturesUpdate(ctx: ConsumedEventContext): Promise<void> {
    const rawFeatures = ctx.payload.features;
    if (!rawFeatures || typeof rawFeatures !== 'object' || Array.isArray(rawFeatures)) {
      throw new PoisonEventError('Features payload must be an object');
    }

    const features: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(rawFeatures)) {
      features[k] = Boolean(v);
    }

    let effectiveAt = ctx.occurredAt;
    if (typeof ctx.payload.effectiveAt === 'string') {
      const parsed = new Date(ctx.payload.effectiveAt);
      if (!Number.isNaN(parsed.getTime())) {
        effectiveAt = parsed;
      }
    }

    await this.tenantState.updateFeatures(
      ctx.tenantId,
      features,
      effectiveAt,
      ctx.tx,
    );
    this.logger.log(`Updated features for tenant ${ctx.tenantId}`);
  }

  private async handleDataRetentionExpired(
    ctx: ConsumedEventContext,
  ): Promise<void> {
    const tenantId = ctx.tenantId;

    // Delete in order to avoid FK constraint issues
    await ctx.tx.alert.deleteMany({ where: { tenantId } });
    await ctx.tx.clockEventCorrection.deleteMany({ where: { tenantId } });
    await ctx.tx.clockEvent.deleteMany({ where: { tenantId } });
    await ctx.tx.workday.deleteMany({ where: { tenantId } });
    await ctx.tx.shiftSnapshot.deleteMany({ where: { tenantId } });
    await ctx.tx.tenantState.deleteMany({ where: { tenantId } });
    await ctx.tx.tenantFeatures.deleteMany({ where: { tenantId } });
    await ctx.tx.processedEvent.deleteMany({ where: { tenantId } });

    this.logger.log(`Purged all telemetry data for tenant ${tenantId}`);
  }
}
