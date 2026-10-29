import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { JetStreamService } from '../nats/jetstream.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import { TowerGateway } from './tower.gateway';
import { TOWER_EVENTS } from './tower.patterns';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import type {
  SiteSummary,
  SiteSummarySnapshot,
  TowerSnapshotResponse,
} from './dto';

@Injectable()
export class TowerService {
  private readonly logger = new Logger(TowerService.name);

  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly jetstream: JetStreamService,
    private readonly tenantState: TenantStateService,
    private readonly gateway: TowerGateway,
  ) {}

  /**
   * Computes the real-time site summary:
   * - expected: assigned employees of shifts currently in progress.
   * - present: employees with open IN (breaks count as present; excluded only on OUT).
   * - openAlerts: count of alerts in OPEN or ACKNOWLEDGED status.
   */
  async getSiteSummary(
    tenantId: string,
    siteId: string,
    overrideNow?: Date,
  ): Promise<SiteSummary> {
    const now = overrideNow ?? new Date();

    // 1. Expected employees: shifts currently in progress with an assigned employee
    const activeShifts = await this.prisma.shiftSnapshot.findMany({
      where: {
        tenantId,
        siteId,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
    });

    const expected = activeShifts.filter((s) => s.employeeId !== null).length;

    // 2. Present employees: for each active shift, check if latest event is NOT OUT
    let present = 0;
    for (const shift of activeShifts) {
      const events = await this.prisma.clockEvent.findMany({
        where: { tenantId, shiftId: shift.shiftId },
        orderBy: { deviceTime: 'asc' },
      });

      let hasOpenIn = false;
      for (const evt of events) {
        if (evt.type === 'IN') {
          hasOpenIn = true;
        } else if (evt.type === 'OUT') {
          hasOpenIn = false;
        }
      }
      if (hasOpenIn) {
        present++;
      }
    }

    // 3. Open or acknowledged alerts
    const openAlerts = await this.prisma.alert.count({
      where: {
        tenantId,
        siteId,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
    });

    return {
      siteId,
      expected,
      present,
      openAlerts,
    };
  }

  /**
   * Emits site_summary_updated to JetStream and forwards directly to the WebSocket room.
   */
  async emitSiteSummaryUpdated(
    tenantId: string,
    siteId: string,
    overrideNow?: Date,
  ): Promise<SiteSummary | null> {
    const hasTower = await this.tenantState.hasFeature(tenantId, 'tower');
    const isSuspended = await this.tenantState.isSuspended(tenantId);
    if (!hasTower || isSuspended) {
      return null;
    }

    const summary = await this.getSiteSummary(tenantId, siteId, overrideNow);

    // 1. Publish JetStream domain event
    await this.jetstream.publish(tenantId, TOWER_EVENTS.SITE_SUMMARY_UPDATED, {
      eventId: randomUUID(),
      tenantId,
      siteId,
      expected: summary.expected,
      present: summary.present,
      openAlerts: summary.openAlerts,
      occurredAt: (overrideNow ?? new Date()).toISOString(),
    });

    // 2. Broadcast via WebSocket Gateway to authorized rooms
    this.gateway.broadcastSiteSummary(tenantId, siteId, summary);

    return summary;
  }

  /**
   * Returns snapshot of authorized sites with their summaries and open alerts.
   */
  async getSnapshot(actor: VerifiedActor): Promise<TowerSnapshotResponse> {
    let siteIds: string[] = [];

    if (actor.role === 'supervisor') {
      siteIds = actor.siteIds;
    } else {
      // Owner or Admin gets all sites of the tenant
      const sites = await this.prisma.shiftSnapshot.findMany({
        where: { tenantId: actor.tenantId },
        select: { siteId: true },
        distinct: ['siteId'],
      });
      siteIds = sites.map((s) => s.siteId);
    }

    const items: SiteSummarySnapshot[] = await Promise.all(
      siteIds.map(async (siteId) => {
        const summary = await this.getSiteSummary(actor.tenantId, siteId);
        const alerts = await this.prisma.alert.findMany({
          where: {
            tenantId: actor.tenantId,
            siteId,
            status: { in: ['OPEN', 'ACKNOWLEDGED'] },
          },
          orderBy: { createdAt: 'desc' },
        });

        return {
          ...summary,
          alerts,
        };
      }),
    );

    return { items };
  }
}
