import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { JetStreamService } from '../nats/jetstream.service';
import { GeofenceService } from '../geofence/geofence.service';
import { EmployeeCacheService } from '../geofence/employee-cache.service';
import { ShiftSnapshotService } from '../shifts/shift-snapshot.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import { WorkdaysService } from '../workdays/workdays.service';
import { AlertsService } from '../alerts/alerts.service';
import { TowerService } from '../tower/tower.service';
import {
  ClockEventNotFoundException,
  ClockTooOldException,
  ForbiddenException,
  NoMatchingShiftException,
} from '../common/exceptions';
import {
  ClockEventTypeDto,
  ClockEventMethodDto,
  CreateClockEventDto,
  CreateManualClockEventDto,
  CorrectClockEventDto,
  ListClockEventsDto,
} from './dto';
import { CLOCK_INS_EVENTS } from './clock-ins.patterns';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import type {
  ClockEvent,
  ClockEventType,
  ClockEventMethod,
} from '../prisma/generated/client';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const TYPE_MAP: Record<ClockEventTypeDto, ClockEventType> = {
  [ClockEventTypeDto.IN]: 'IN',
  [ClockEventTypeDto.OUT]: 'OUT',
  [ClockEventTypeDto.BREAK_START]: 'BREAK_START',
  [ClockEventTypeDto.BREAK_END]: 'BREAK_END',
};

const METHOD_MAP: Record<ClockEventMethodDto, ClockEventMethod> = {
  [ClockEventMethodDto.GPS]: 'GPS',
  [ClockEventMethodDto.QR]: 'QR',
};

@Injectable()
export class ClockInsService {
  private readonly logger = new Logger(ClockInsService.name);

  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly jetstream: JetStreamService,
    private readonly geofence: GeofenceService,
    private readonly employeeCache: EmployeeCacheService,
    private readonly shifts: ShiftSnapshotService,
    private readonly tenantState: TenantStateService,
    private readonly workdaysService: WorkdaysService,
    private readonly alertsService: AlertsService,
    private readonly towerService: TowerService,
  ) {}

  /**
   * Records a worker clock event (IN, OUT, BREAK) via GPS or QR with geofence validation.
   */
  async createClockEvent(
    actor: VerifiedActor,
    dto: CreateClockEventDto,
  ): Promise<ClockEvent> {
    const employee = await this.employeeCache.getEmployee(
      actor.tenantId,
      actor.userId,
    );
    if (!employee) {
      throw new ForbiddenException('Employee record not found for user');
    }

    // 1. Idempotency: Return existing event if clientEventId was already processed
    const existing = await this.prisma.clockEvent.findUnique({
      where: {
        tenantId_clientEventId: {
          tenantId: actor.tenantId,
          clientEventId: dto.clientEventId,
        },
      },
    });
    if (existing) {
      return existing;
    }

    // 2. Offline check: Reject events older than 24 hours
    const deviceTime = new Date(dto.deviceTime);
    const now = Date.now();
    if (now - deviceTime.getTime() > TWENTY_FOUR_HOURS_MS) {
      throw new ClockTooOldException();
    }

    // 3. Shift Matching
    let matchedShiftId: string;
    let siteId = dto.siteId;

    if (dto.type === ClockEventTypeDto.IN) {
      const shift = await this.shifts.findMatchingShiftForClockIn(
        actor.tenantId,
        employee.id,
        dto.siteId,
        deviceTime,
      );
      if (!shift) {
        throw new NoMatchingShiftException();
      }
      matchedShiftId = shift.shiftId;
      siteId = shift.siteId;
    } else {
      // For OUT, BREAK_START, BREAK_END: Match shift with an open IN
      const openInEvents = await this.prisma.clockEvent.findMany({
        where: {
          tenantId: actor.tenantId,
          employeeId: employee.id,
          siteId: dto.siteId,
          type: 'IN',
        },
        orderBy: { deviceTime: 'desc' },
      });

      let foundShiftId: string | null = null;
      for (const inEvt of openInEvents) {
        const hasOut = await this.prisma.clockEvent.findFirst({
          where: {
            tenantId: actor.tenantId,
            employeeId: employee.id,
            shiftId: inEvt.shiftId,
            type: 'OUT',
            deviceTime: { gte: inEvt.deviceTime },
          },
        });
        if (!hasOut) {
          foundShiftId = inEvt.shiftId;
          break;
        }
      }

      if (!foundShiftId) {
        throw new NoMatchingShiftException();
      }
      matchedShiftId = foundShiftId;
    }

    // 4. Location check (Haversine & QR evaluation)
    const locResult = await this.geofence.checkLocation(
      actor.tenantId,
      siteId,
      {
        latitude: dto.latitude,
        longitude: dto.longitude,
        qrCode: dto.qrCode,
      },
    );

    // 5. Transaction: Store clock event and open alert if outside geofence
    const event = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.clockEvent.create({
        data: {
          tenantId: actor.tenantId,
          shiftId: matchedShiftId,
          employeeId: employee.id,
          siteId,
          type: TYPE_MAP[dto.type],
          method: METHOD_MAP[dto.method],
          latitude: dto.latitude,
          longitude: dto.longitude,
          distanceMeters: locResult.distanceMeters,
          outOfGeofence: locResult.outOfGeofence,
          clientEventId: dto.clientEventId,
          deviceTime,
          receivedAt: new Date(now),
        },
      });

      if (locResult.outOfGeofence) {
        const hasAlerts = await this.tenantState.hasFeature(
          actor.tenantId,
          'alerts',
        );
        if (hasAlerts) {
          await tx.alert.create({
            data: {
              tenantId: actor.tenantId,
              type: 'OUT_OF_GEOFENCE',
              status: 'OPEN',
              siteId,
              shiftId: matchedShiftId,
              employeeId: employee.id,
              clockEventId: saved.id,
            },
          });
        }
      }

      return saved;
    });

    // 6. Emit JetStream domain event
    await this.jetstream.publish(
      actor.tenantId,
      CLOCK_INS_EVENTS.RECORDED,
      {
        eventId: randomUUID(),
        tenantId: actor.tenantId,
        clockEventId: event.id,
        shiftId: matchedShiftId,
        employeeId: employee.id,
        siteId,
        type: dto.type,
        method: dto.method,
        outOfGeofence: event.outOfGeofence,
        occurredAt: event.receivedAt.toISOString(),
      },
    );

    // 7. Recompute affected workday
    await this.workdaysService.recomputeWorkday(actor.tenantId, matchedShiftId);

    // 8. Auto-resolve alerts on clock in/out
    if (dto.type === ClockEventTypeDto.IN) {
      await this.alertsService.resolveAlertsOnClockIn(
        actor.tenantId,
        matchedShiftId,
        employee.id,
      );
    } else if (dto.type === ClockEventTypeDto.OUT) {
      await this.alertsService.resolveAlertsOnClockOut(
        actor.tenantId,
        matchedShiftId,
      );
    }

    // 9. Update real-time site summary
    await this.towerService.emitSiteSummaryUpdated(actor.tenantId, siteId);

    return event;
  }

  /**
   * Creates a manual clock event (supervisor or admin) with mandatory audit reason.
   */
  async createManualClockEvent(
    actor: VerifiedActor,
    dto: CreateManualClockEventDto,
  ): Promise<ClockEvent> {
    const shift = await this.shifts.getShift(actor.tenantId, dto.shiftId);
    if (!shift) {
      throw new NoMatchingShiftException();
    }

    // Supervisors can only act on their assigned sites
    if (actor.role === 'supervisor' && !actor.siteIds.includes(shift.siteId)) {
      throw new ClockEventNotFoundException();
    }

    const event = await this.prisma.clockEvent.create({
      data: {
        tenantId: actor.tenantId,
        shiftId: shift.shiftId,
        employeeId: dto.employeeId,
        siteId: shift.siteId,
        type: TYPE_MAP[dto.type],
        method: 'MANUAL',
        clientEventId: `manual_${randomUUID()}`,
        deviceTime: new Date(dto.time),
        receivedAt: new Date(),
        createdByUserId: actor.userId,
        reason: dto.reason,
      },
    });

    await this.jetstream.publish(
      actor.tenantId,
      CLOCK_INS_EVENTS.RECORDED,
      {
        eventId: randomUUID(),
        tenantId: actor.tenantId,
        clockEventId: event.id,
        shiftId: shift.shiftId,
        employeeId: dto.employeeId,
        siteId: shift.siteId,
        type: dto.type,
        method: 'manual',
        outOfGeofence: false,
        occurredAt: event.receivedAt.toISOString(),
      },
    );

    // 7. Recompute affected workday
    await this.workdaysService.recomputeWorkday(actor.tenantId, shift.shiftId);

    // 8. Auto-resolve alerts on clock in/out
    if (dto.type === ClockEventTypeDto.IN) {
      await this.alertsService.resolveAlertsOnClockIn(
        actor.tenantId,
        shift.shiftId,
        dto.employeeId,
      );
    } else if (dto.type === ClockEventTypeDto.OUT) {
      await this.alertsService.resolveAlertsOnClockOut(
        actor.tenantId,
        shift.shiftId,
      );
    }

    // 9. Update real-time site summary
    await this.towerService.emitSiteSummaryUpdated(actor.tenantId, shift.siteId);

    return event;
  }

  /**
   * Corrects a clock event with non-destructive audit history.
   */
  async correctClockEvent(
    actor: VerifiedActor,
    clockEventId: string,
    dto: CorrectClockEventDto,
  ): Promise<ClockEvent> {
    const existing = await this.prisma.clockEvent.findFirst({
      where: { id: clockEventId, tenantId: actor.tenantId },
    });
    if (!existing) {
      throw new ClockEventNotFoundException();
    }

    if (actor.role === 'supervisor' && !actor.siteIds.includes(existing.siteId)) {
      throw new ClockEventNotFoundException();
    }

    const before = {
      type: existing.type,
      deviceTime: existing.deviceTime.toISOString(),
    };

    const newType = dto.type ? TYPE_MAP[dto.type] : existing.type;
    const newDeviceTime = dto.time ? new Date(dto.time) : existing.deviceTime;

    const after = {
      type: newType,
      deviceTime: newDeviceTime.toISOString(),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.clockEventCorrection.create({
        data: {
          tenantId: actor.tenantId,
          clockEventId: existing.id,
          before,
          after,
          reason: dto.reason,
          correctedByUserId: actor.userId,
        },
      });

      return await tx.clockEvent.update({
        where: { id: existing.id },
        data: {
          type: newType,
          deviceTime: newDeviceTime,
        },
      });
    });

    await this.jetstream.publish(
      actor.tenantId,
      CLOCK_INS_EVENTS.CORRECTED,
      {
        eventId: randomUUID(),
        tenantId: actor.tenantId,
        clockEventId: updated.id,
        shiftId: updated.shiftId,
        actorId: actor.userId,
        occurredAt: new Date().toISOString(),
      },
    );

    await this.workdaysService.recomputeWorkday(actor.tenantId, updated.shiftId);

    // 8. Update real-time site summary
    await this.towerService.emitSiteSummaryUpdated(actor.tenantId, updated.siteId);

    return updated;
  }

  /**
   * Lists clock events applying strict multi-tenant and role-based scoping.
   */
  async listClockEvents(
    actor: VerifiedActor,
    query: ListClockEventsDto,
  ): Promise<{ items: ClockEvent[]; total: number }> {
    const where: any = { tenantId: actor.tenantId };

    if (actor.role === 'employee') {
      const emp = await this.employeeCache.getEmployee(
        actor.tenantId,
        actor.userId,
      );
      where.employeeId = emp?.id ?? '00000000-0000-0000-0000-000000000000';
    } else if (actor.role === 'supervisor') {
      if (query.siteId) {
        if (!actor.siteIds.includes(query.siteId)) {
          throw new ClockEventNotFoundException();
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
    if (query.employeeId && actor.role !== 'employee') {
      where.employeeId = query.employeeId;
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.clockEvent.findMany({
        where,
        orderBy: { deviceTime: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.clockEvent.count({ where }),
    ]);

    return { items, total };
  }
}
