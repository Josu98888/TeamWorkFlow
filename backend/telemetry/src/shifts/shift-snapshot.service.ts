import { Injectable, Logger } from '@nestjs/common';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { NatsClientService } from '../nats/nats-client.service';
import type { ShiftDto } from '../nats/dto/nats-contracts';
import type { Prisma, ShiftSnapshot, ShiftStatus } from '../prisma/generated/client';

export const CLOCK_IN_EARLY_MINUTES = 15;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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
          ...(remote.authorizedOvertimeMinutes !== undefined
            ? { authorizedOvertimeMinutes: remote.authorizedOvertimeMinutes }
            : {}),
          employeeId: remote.employeeId ?? null,
          version: remote.version,
        },
        create: {
          shiftId: remote.id,
          tenantId: remote.tenantId,
          siteId: remote.siteId,
          postId: remote.postId,
          employeeId: remote.employeeId ?? null,
          startsAt: new Date(remote.startsAt),
          endsAt: new Date(remote.endsAt),
          ...(remote.authorizedOvertimeMinutes !== undefined
            ? { authorizedOvertimeMinutes: remote.authorizedOvertimeMinutes }
            : {}),
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
  async upsertShift(remote: ShiftDto, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const existing = await client.shiftSnapshot.findFirst({
      where: { shiftId: remote.id },
    });

    if (existing && existing.version > remote.version) {
      this.logger.debug(
        `Ignoring stale shift update for ${remote.id} (stored: ${existing.version}, incoming: ${remote.version})`,
      );
      return;
    }

    await client.shiftSnapshot.upsert({
      where: { shiftId: remote.id },
      update: {
        status: remote.status,
        startsAt: new Date(remote.startsAt),
        endsAt: new Date(remote.endsAt),
        ...(remote.authorizedOvertimeMinutes !== undefined
          ? { authorizedOvertimeMinutes: remote.authorizedOvertimeMinutes }
          : {}),
        employeeId: remote.employeeId ?? null,
        version: remote.version,
      },
      create: {
        shiftId: remote.id,
        tenantId: remote.tenantId,
        siteId: remote.siteId,
        postId: remote.postId,
        employeeId: remote.employeeId ?? null,
        startsAt: new Date(remote.startsAt),
        endsAt: new Date(remote.endsAt),
        ...(remote.authorizedOvertimeMinutes !== undefined
          ? { authorizedOvertimeMinutes: remote.authorizedOvertimeMinutes }
          : {}),
        status: remote.status,
        version: remote.version,
      },
    });
  }

  /**
   * Updates shift status when shift starts, ends, or is cancelled.
   */
  async updateShiftStatus(
    tenantId: string,
    shiftId: string,
    status: ShiftStatus,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.shiftSnapshot.updateMany({
      where: { tenantId, shiftId },
      data: { status },
    });
  }

  /**
   * Matches an 'IN' clock event to a shift of the employee for the given site and deviceTime:
   * From 15 minutes BEFORE the shift start until the shift effective end (`endsAt + authorizedOvertimeMinutes`).
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

    const candidates = shifts.filter((shift) => {
      const windowStart =
        shift.startsAt.getTime() - CLOCK_IN_EARLY_MINUTES * 60 * 1000;
      const windowEnd =
        shift.endsAt.getTime() +
        ((shift as { authorizedOvertimeMinutes?: number }).authorizedOvertimeMinutes ?? 0) *
          60 *
          1000;
      return time >= windowStart && time <= windowEnd;
    });

    if (candidates.length <= 1) {
      return candidates[0] ?? null;
    }

    return this.pickAmongCandidates(tenantId, employeeId, candidates);
  }

  /**
   * Detects when an employee tries to clock IN earlier than `startsAt - 15 min` for an
   * upcoming shift at that site within the next 24 hours.
   */
  async findUpcomingTooEarlyShift(
    tenantId: string,
    employeeId: string,
    siteId: string,
    deviceTime: Date,
  ): Promise<ShiftSnapshot | null> {
    const time = deviceTime.getTime();
    const shifts = await this.prisma.shiftSnapshot.findMany({
      where: {
        tenantId,
        employeeId,
        siteId,
        status: { not: 'CANCELLED' },
      },
      orderBy: { startsAt: 'asc' },
    });

    return (
      shifts.find((shift) => {
        const earlyWindowStart =
          shift.startsAt.getTime() - CLOCK_IN_EARLY_MINUTES * 60 * 1000;
        const diff = shift.startsAt.getTime() - time;
        return time < earlyWindowStart && diff > 0 && diff <= TWENTY_FOUR_HOURS_MS;
      }) ?? null
    );
  }

  /**
   * Several shifts match the same clock-in (back-to-back shifts within the early window).
   * Preference: 1) a shift with an open pair (an IN with no later OUT), so the employee
   * closes what they started; 2) a shift without clock events yet; 3) the first by startsAt.
   * `candidates` is already ordered by startsAt.
   */
  private async pickAmongCandidates(
    tenantId: string,
    employeeId: string,
    candidates: ShiftSnapshot[],
  ): Promise<ShiftSnapshot> {
    const events = await this.prisma.clockEvent.findMany({
      where: {
        tenantId,
        employeeId,
        shiftId: { in: candidates.map((shift) => shift.shiftId) },
        type: { in: ['IN', 'OUT'] },
      },
      select: { shiftId: true, type: true, deviceTime: true },
    });

    const hasOpenPair = (shiftId: string) => {
      const own = events.filter((event) => event.shiftId === shiftId);
      return own.some(
        (event) =>
          event.type === 'IN' &&
          !own.some(
            (out) =>
              out.type === 'OUT' &&
              out.deviceTime.getTime() >= event.deviceTime.getTime(),
          ),
      );
    };

    return (
      candidates.find((shift) => hasOpenPair(shift.shiftId)) ??
      candidates.find(
        (shift) => !events.some((event) => event.shiftId === shift.shiftId),
      ) ??
      candidates[0]
    );
  }
}
