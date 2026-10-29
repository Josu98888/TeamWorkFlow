import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ConsumedEventProcessor,
  type ConsumedEventContext,
} from '../consumed-event.processor';
import { CONSUMED_SUBJECTS } from '../consumers.constants';
import { TenantStateService } from '../../tenants/tenant-state.service';

@Injectable()
export class AuthConsumer implements OnModuleInit {
  private readonly logger = new Logger(AuthConsumer.name);

  constructor(
    private readonly processor: ConsumedEventProcessor,
    private readonly tenantState: TenantStateService,
  ) {}

  onModuleInit(): void {
    this.processor.register({
      filter: CONSUMED_SUBJECTS.TENANT_SUSPENDED,
      handle: (ctx) => this.handleSuspension(ctx, true),
    });

    this.processor.register({
      filter: CONSUMED_SUBJECTS.TENANT_CANCELLED,
      handle: (ctx) => this.handleSuspension(ctx, true),
    });

    this.processor.register({
      filter: CONSUMED_SUBJECTS.TENANT_REACTIVATED,
      handle: (ctx) => this.handleSuspension(ctx, false),
    });
  }

  private async handleSuspension(
    ctx: ConsumedEventContext,
    isSuspended: boolean,
  ): Promise<void> {
    await this.tenantState.setSuspended(ctx.tenantId, isSuspended, ctx.tx);
    this.logger.log(
      `Tenant ${ctx.tenantId} status updated: isSuspended=${isSuspended}`,
    );
  }
}
