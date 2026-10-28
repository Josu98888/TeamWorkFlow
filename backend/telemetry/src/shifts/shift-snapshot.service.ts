import { Injectable, Logger } from '@nestjs/common';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { NatsClientService } from '../nats/nats-client.service';
import type { ShiftDto } from '../nats/dto/nats-contracts';
import type { ShiftSnapshot } from '../prisma/generated/client';

export const CLOCK_IN_EARLY_MINUTES = 60;

@Injectable()
export class ShiftSnapshotService {
  private readonly logger = new Logger(ShiftSnapshotService.name);

  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly natsClient: NatsClientService,
  ) {}

  /**
   * Retrieves a shift snapshot from local DB or falls back to NATS organization.shift.get on miss.
   */
  async getShift(tenantId: string, shiftId: string): Promise<ShiftSnapshot | null> {
    const local = await this.prisma.shiftSnapshot.findFirst({
      where: { tenantId, shiftId },
    });

    if (local) {
      return local;
    }

    try {
      const remote = await this.natsClient.getShift(tenantId, shiftId);
      if (!remote) return null;

      return await this.prisma.shiftSnapshot.upsert({
        where: { shiftId: remote.id },
        update: {
          status: remote.status,
          startsAt: new Date(remote.startsAt),
          endsAt: new Date(remote.endsAt),
          employeeId: remote.employeeId,
          version: remote.version,
        },
        create: {
          shiftId: remote.id,
          tenantId: remote.tenantId,
          siteId: remote.siteId,
          postId: remote.postId,
          employeeId: remote.employeeId,
          startsAt: new Date(remote.startsAt),
          endsAt: new Date(remote.endsAt),
          status: remote.status,
          version: remote.version,
        },
      });
    } catch (err) {
      this.logger.warn(`Could not fetch shift ${shiftId} via NATS: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Upserts a shift snapshot only if the incoming version is greater than or equal to the stored one.
   */
  async upsertShift(remote: ShiftDto): Promise<void> {
    const existing = await this.prisma.shiftSnapshot.findFirst({
      where: { shiftId: remote.id },
    });

    if (existing && existing.version > remote.version) {
      this.logger.debug(
        `Ignoring stale shift update for ${remote.id} (stored: ${existing.version}, incoming: ${remote.version})`,
      );
      return;
    }

    await this.prisma.shiftSnapshot.upsert({
      where: { shiftId: remote.id },
      update: {
        status: remote.status,
        startsAt: new Date(remote.startsAt),
        endsAt: new Date(remote.endsAt),
        employeeId: remote.employeeId,
        version: remote.version,
      },
      create: {
        shiftId: remote.id,
        tenantId: remote.tenantId,
        siteId: remote.siteId,
        postId: remote.postId,
        employeeId: remote.employeeId,
        startsAt: new Date(remote.startsAt),
        endsAt: new Date(remote.endsAt),
        status: remote.status,
        version: remote.version,
      },
    });
  }

  /**
   * Matches an 'IN' clock event to a shift of the employee for the given site and deviceTime:
   * From 60 minutes BEFORE the shift start until the shift end.
   */
  async findMatchingShiftForClockIn(
    tenantId: string,
    employeeId: string,
    siteId: string,
    deviceTime: Date,
  ): Promise<ShiftSnapshot | null> {
    const time = deviceTime.getTime();

    // Query non-cancelled shifts of the employee at the site
    const shifts = await this.prisma.shiftSnapshot.findMany({
      where: {
        tenantId,
        employeeId,
        siteId,
        status: { not: 'CANCELLED' },
      },
      orderBy: { startsAt: 'asc' },
    });

    for (const shift of shifts) {
      const windowStart = new Date(shift.startsAt.getTime() - CLOCK_IN_EARLY_MINUTES * 60 * 1000).getTime();
      const windowEnd = shift.endsAt.getTime();

      if (time >= windowStart && time <= windowEnd) {
        return shift;
      }
    }

    return null;
  }
}
