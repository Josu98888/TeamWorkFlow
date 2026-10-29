import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { JetStreamService } from '../nats/jetstream.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import { ShiftSnapshotService } from '../shifts/shift-snapshot.service';
import { WorkdaysService } from '../workdays/workdays.service';
import { TowerService } from '../tower/tower.service';
import {
  AlertNotFoundException,
  AlertInvalidTransitionException,
  ForbiddenException,
} from '../common/exceptions';
import {
  AlertStatusDto,
  AlertTypeDto,
  ListAlertsDto,
  ResolveAlertDto,
} from './dto';
import { ALERT_THRESHOLDS, ALERTS_EVENTS } from './alerts.patterns';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import type { Alert, AlertStatus, AlertType } from '../prisma/generated/client';

const STATUS_MAP: Record<AlertStatusDto, AlertStatus> = {
  [AlertStatusDto.OPEN]: 'OPEN',
  [AlertStatusDto.ACKNOWLEDGED]: 'ACKNOWLEDGED',
  [AlertStatusDto.RESOLVED]: 'RESOLVED',
};

const TYPE_MAP: Record<AlertTypeDto, AlertType> = {
  [AlertTypeDto.LATE]: 'LATE',
  [AlertTypeDto.UNCOVERED_POST]: 'UNCOVERED_POST',
  [AlertTypeDto.OUT_OF_GEOFENCE]: 'OUT_OF_GEOFENCE',
  [AlertTypeDto.MISSING_CLOCK_OUT]: 'MISSING_CLOCK_OUT',
};

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly jetstream: JetStreamService,
    private readonly tenantState: TenantStateService,
    private readonly shifts: ShiftSnapshotService,
    private readonly workdays: WorkdaysService,
    private readonly tower: TowerService,
  ) {}

  /**
   * Opens an alert idempotently and emits the alert_opened domain event.
   */
  async openAlert(
    tenantId: string,
    type: AlertType,
    siteId: string,
    shiftId: string,
    employeeId?: string,
    clockEventId?: string,
  ): Promise<Alert | null> {
    const hasAlerts = await this.tenantState.hasFeature(tenantId, 'alerts');
    const isSuspended = await this.tenantState.isSuspended(tenantId);
    if (!hasAlerts || isSuspended) {
      return null;
    }

    // Idempotency check:
    // For OUT_OF_GEOFENCE: at most 1 per clockEventId
    if (type === 'OUT_OF_GEOFENCE' && clockEventId) {
      const existing = await this.prisma.alert.findFirst({
        where: { tenantId, clockEventId, type: 'OUT_OF_GEOFENCE' },
      });
      if (existing) return existing;
    } else {
      // For LATE, UNCOVERED_POST, MISSING_CLOCK_OUT: at most 1 per (shiftId, type)
      const existing = await this.prisma.alert.findFirst({
        where: { tenantId, shiftId, type },
      });
      if (existing) return existing;
    }

    const alert = await this.prisma.alert.create({
      data: {
        tenantId,
        type,
        status: 'OPEN',
        siteId,
        shiftId,
        employeeId,
        clockEventId,
      },
    });

    await this.jetstream.publish(tenantId, ALERTS_EVENTS.OPENED, {
      eventId: randomUUID(),
      tenantId,
      alertId: alert.id,
      type: alert.type.toLowerCase(),
      status: alert.status.toLowerCase(),
      siteId: alert.siteId,
      shiftId: alert.shiftId,
      employeeId: alert.employeeId,
      clockEventId: alert.clockEventId,
      occurredAt: alert.createdAt.toISOString(),
    });

    await this.tower.emitSiteSummaryUpdated(tenantId, alert.siteId);

    return alert;
  }

  /**
   * Acknowledges an alert by a supervisor or admin.
   */
  async acknowledgeAlert(actor: VerifiedActor, alertId: string): Promise<Alert> {
    const alert = await this.prisma.alert.findFirst({
      where: { id: alertId, tenantId: actor.tenantId },
    });
    if (!alert) {
      throw new AlertNotFoundException();
    }

    if (actor.role === 'supervisor' && !actor.siteIds.includes(alert.siteId)) {
      throw new AlertNotFoundException();
    }

    if (alert.status !== 'OPEN') {
      throw new AlertInvalidTransitionException(
        `Cannot acknowledge alert with status ${alert.status}`,
      );
    }

    const acknowledgedAt = new Date();
    const updated = await this.prisma.alert.update({
      where: { id: alert.id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedBy: actor.userId,
        acknowledgedAt,
      },
    });

    await this.jetstream.publish(actor.tenantId, ALERTS_EVENTS.ACKNOWLEDGED, {
      eventId: randomUUID(),
      tenantId: actor.tenantId,
      alertId: updated.id,
      acknowledgedBy: actor.userId,
      occurredAt: acknowledgedAt.toISOString(),
    });

    await this.tower.emitSiteSummaryUpdated(actor.tenantId, updated.siteId);

    return updated;
  }

  /**
   * Manually resolves an alert by a supervisor or admin.
   */
  async resolveAlert(
    actor: VerifiedActor,
    alertId: string,
    _dto?: ResolveAlertDto,
  ): Promise<Alert> {
    const alert = await this.prisma.alert.findFirst({
      where: { id: alertId, tenantId: actor.tenantId },
    });
    if (!alert) {
      throw new AlertNotFoundException();
    }

    if (actor.role === 'supervisor' && !actor.siteIds.includes(alert.siteId)) {
      throw new AlertNotFoundException();
    }

    if (alert.status === 'RESOLVED') {
      throw new AlertInvalidTransitionException('Alert is already resolved');
    }

    const resolvedAt = new Date();
    const updated = await this.prisma.alert.update({
      where: { id: alert.id },
      data: {
        status: 'RESOLVED',
        resolvedBy: actor.userId,
        resolvedAt,
      },
    });

    await this.jetstream.publish(actor.tenantId, ALERTS_EVENTS.RESOLVED, {
      eventId: randomUUID(),
      tenantId: actor.tenantId,
      alertId: updated.id,
      resolvedBy: actor.userId,
      occurredAt: resolvedAt.toISOString(),
    });

    await this.tower.emitSiteSummaryUpdated(actor.tenantId, updated.siteId);

    return updated;
  }

  /**
   * Auto-resolves UNCOVERED_POST (any IN) and LATE (assigned employee IN) on clock in.
   */
  async resolveAlertsOnClockIn(
    tenantId: string,
    shiftId: string,
    employeeId?: string,
  ): Promise<void> {
    const resolvedAt = new Date();

    // 1. Resolve UNCOVERED_POST on any IN
    const uncoveredAlerts = await this.prisma.alert.findMany({
      where: {
        tenantId,
        shiftId,
        type: 'UNCOVERED_POST',
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
    });

    for (const a of uncoveredAlerts) {
      await this.prisma.alert.update({
        where: { id: a.id },
        data: {
          status: 'RESOLVED',
          resolvedBy: 'system',
          resolvedAt,
        },
      });

      await this.jetstream.publish(tenantId, ALERTS_EVENTS.RESOLVED, {
        eventId: randomUUID(),
        tenantId,
        alertId: a.id,
        resolvedBy: 'system',
        occurredAt: resolvedAt.toISOString(),
      });
    }

    // 2. Resolve LATE when assigned employee arrives
    const lateQuery: any = {
      tenantId,
      shiftId,
      type: 'LATE',
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
    };
    if (employeeId) {
      lateQuery.employeeId = employeeId;
    }

    const lateAlerts = await this.prisma.alert.findMany({ where: lateQuery });
    for (const a of lateAlerts) {
      await this.prisma.alert.update({
        where: { id: a.id },
        data: {
          status: 'RESOLVED',
          resolvedBy: 'system',
          resolvedAt,
        },
      });

      await this.jetstream.publish(tenantId, ALERTS_EVENTS.RESOLVED, {
        eventId: randomUUID(),
        tenantId,
        alertId: a.id,
        resolvedBy: 'system',
        occurredAt: resolvedAt.toISOString(),
      });
    }

    if (uncoveredAlerts.length > 0 || lateAlerts.length > 0) {
      const siteId = uncoveredAlerts[0]?.siteId ?? lateAlerts[0]?.siteId;
      if (siteId) {
        await this.tower.emitSiteSummaryUpdated(tenantId, siteId);
      }
    }
  }

  /**
   * Auto-resolves MISSING_CLOCK_OUT when matching OUT arrives.
   */
  async resolveAlertsOnClockOut(
    tenantId: string,
    shiftId: string,
  ): Promise<void> {
    const resolvedAt = new Date();
    const missingOutAlerts = await this.prisma.alert.findMany({
      where: {
        tenantId,
        shiftId,
        type: 'MISSING_CLOCK_OUT',
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
    });

    for (const a of missingOutAlerts) {
      await this.prisma.alert.update({
        where: { id: a.id },
        data: {
          status: 'RESOLVED',
          resolvedBy: 'system',
          resolvedAt,
        },
      });

      await this.jetstream.publish(tenantId, ALERTS_EVENTS.RESOLVED, {
        eventId: randomUUID(),
        tenantId,
        alertId: a.id,
        resolvedBy: 'system',
        occurredAt: resolvedAt.toISOString(),
      });
    }

    if (missingOutAlerts.length > 0 && missingOutAlerts[0]?.siteId) {
      await this.tower.emitSiteSummaryUpdated(
        tenantId,
        missingOutAlerts[0].siteId,
      );
    }
  }

  /**
   * Lists alerts with role-based site scoping and multi-tenant filters.
   */
  async listAlerts(
    actor: VerifiedActor,
    query: ListAlertsDto,
  ): Promise<{ items: Alert[]; total: number }> {
    const where: any = { tenantId: actor.tenantId };

    if (actor.role === 'supervisor') {
      if (query.siteId) {
        if (!actor.siteIds.includes(query.siteId)) {
          throw new ForbiddenException('Supervisor not assigned to this site');
        }
        where.siteId = query.siteId;
      } else {
        where.siteId = { in: actor.siteIds };
      }
    } else if (query.siteId) {
      where.siteId = query.siteId;
    }

    if (query.shiftId) {
      where.shiftId = query.shiftId;
    }
    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }
    if (query.status) {
      where.status = STATUS_MAP[query.status];
    }
    if (query.type) {
      where.type = TYPE_MAP[query.type];
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.alert.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Periodic check executed every minute:
   * Evaluates LATE, UNCOVERED_POST, and triggers MISSING_CLOCK_OUT recomputations.
   */
  @Cron('* * * * *')
  async runPeriodicChecks(overrideNow?: Date): Promise<{
    checkedTenants: number;
    openedAlerts: number;
  }> {
    const now = overrideNow ?? new Date();

    const tenantRecords = await this.prisma.shiftSnapshot.findMany({
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    let checkedTenants = 0;
    let openedAlerts = 0;

    for (const { tenantId } of tenantRecords) {
      if (await this.tenantState.isSuspended(tenantId)) {
        continue;
      }
      if (!(await this.tenantState.hasFeature(tenantId, 'alerts'))) {
        continue;
      }

      checkedTenants++;

      // Check shifts starting within the last 24h that haven't been cancelled
      const shifts = await this.prisma.shiftSnapshot.findMany({
        where: {
          tenantId,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          startsAt: { lte: now },
        },
      });

      for (const shift of shifts) {
        const elapsedSinceStartMinutes =
          (now.getTime() - shift.startsAt.getTime()) / 60000;

        const events = await this.prisma.clockEvent.findMany({
          where: { tenantId, shiftId: shift.shiftId },
        });
        const hasAnyIn = events.some((e) => e.type === 'IN');

        // 1. Check LATE (10 minutes after start without assigned employee IN)
        if (
          shift.employeeId &&
          elapsedSinceStartMinutes >= ALERT_THRESHOLDS.LATE_MINUTES &&
          !hasAnyIn
        ) {
          const alert = await this.openAlert(
            tenantId,
            'LATE',
            shift.siteId,
            shift.shiftId,
            shift.employeeId,
          );
          if (alert) openedAlerts++;
        }

        // 2. Check UNCOVERED_POST (15 minutes after start without any IN)
        if (
          elapsedSinceStartMinutes >= ALERT_THRESHOLDS.UNCOVERED_POST_MINUTES &&
          !hasAnyIn
        ) {
          const alert = await this.openAlert(
            tenantId,
            'UNCOVERED_POST',
            shift.siteId,
            shift.shiftId,
            shift.employeeId ?? undefined,
          );
          if (alert) openedAlerts++;
        }

        // 3. Check MISSING_CLOCK_OUT (2 hours after shift ends with open IN)
        const elapsedSinceEndHours =
          (now.getTime() - shift.endsAt.getTime()) / (3600 * 1000);
        if (elapsedSinceEndHours >= ALERT_THRESHOLDS.MISSING_CLOCK_OUT_HOURS) {
          await this.workdays.recomputeWorkday(tenantId, shift.shiftId);
        }
      }
    }

    return { checkedTenants, openedAlerts };
  }
}
