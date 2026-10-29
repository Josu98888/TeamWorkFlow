import { Injectable, Logger } from '@nestjs/common';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import type { Prisma } from '../prisma/generated/client';

@Injectable()
export class TenantStateService {
  private readonly logger = new Logger(TenantStateService.name);

  constructor(private readonly prisma: AttendancePrismaService) {}

  /**
   * Checks whether a tenant is suspended or cancelled.
   * Missing row means active (not suspended).
   */
  async isSuspended(tenantId: string): Promise<boolean> {
    const state = await this.prisma.tenantState.findFirst({
      where: { tenantId },
    });
    return state?.isSuspended ?? false;
  }

  /**
   * Sets suspension state when receiving tenant_suspended, tenant_cancelled or tenant_reactivated.
   */
  async setSuspended(tenantId: string, isSuspended: boolean, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.tenantState.upsert({
      where: { tenantId },
      update: { isSuspended },
      create: { tenantId, isSuspended },
    });
  }

  /**
   * Evaluates feature access for domain background tasks (fail-closed: missing row means no pro features).
   */
  async hasFeature(
    tenantId: string,
    feature: 'alerts' | 'tower',
  ): Promise<boolean> {
    const record = await this.prisma.tenantFeatures.findFirst({
      where: { tenantId },
    });

    if (!record || !record.features || typeof record.features !== 'object') {
      return false; // Fail-closed: basic plan
    }

    const features = record.features as Record<string, unknown>;
    return Boolean(features[feature]);
  }

  /**
   * Updates tenant features ignoring stale events (effectiveAt <= stored.effectiveAt).
   */
  async updateFeatures(
    tenantId: string,
    features: Record<string, boolean>,
    effectiveAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const existing = await client.tenantFeatures.findFirst({
      where: { tenantId },
    });

    if (existing && existing.effectiveAt >= effectiveAt) {
      this.logger.debug(
        `Ignoring stale feature update for tenant ${tenantId} (stored: ${existing.effectiveAt.toISOString()}, incoming: ${effectiveAt.toISOString()})`,
      );
      return;
    }

    await client.tenantFeatures.upsert({
      where: { tenantId },
      update: {
        features,
        effectiveAt,
      },
      create: {
        tenantId,
        features,
        effectiveAt,
      },
    });
  }
}
