import { ShiftSnapshotService } from './shift-snapshot.service';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { NatsClientService } from '../nats/nats-client.service';
import type { ShiftDto } from '../nats/dto/nats-contracts';

describe('ShiftSnapshotService', () => {
  let service: ShiftSnapshotService;
  let mockPrisma: any;
  let mockNatsClient: any;

  const mockShift: ShiftDto = {
    id: 'shift-1',
    tenantId: 'tenant-1',
    siteId: 'site-1',
    postId: 'post-1',
    employeeId: 'employee-1',
    startsAt: '2026-10-28T09:00:00.000Z',
    endsAt: '2026-10-28T17:00:00.000Z',
    status: 'SCHEDULED',
    version: 1,
  };

  beforeEach(() => {
    mockPrisma = {
      shiftSnapshot: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    mockNatsClient = {
      getShift: jest.fn(),
    };
    service = new ShiftSnapshotService(
      mockPrisma as unknown as AttendancePrismaService,
      mockNatsClient as unknown as NatsClientService,
    );
  });

  it('returns local shift if present in DB without calling NATS', async () => {
    mockPrisma.shiftSnapshot.findFirst.mockResolvedValueOnce({
      shiftId: 'shift-1',
      tenantId: 'tenant-1',
      version: 1,
    });

    const shift = await service.getShift('tenant-1', 'shift-1');
    expect(shift).toBeDefined();
    expect(mockNatsClient.getShift).not.toHaveBeenCalled();
  });

  it('fetches from NATS on cache miss and upserts locally', async () => {
    mockPrisma.shiftSnapshot.findFirst.mockResolvedValueOnce(null);
    mockNatsClient.getShift.mockResolvedValueOnce(mockShift);
    mockPrisma.shiftSnapshot.upsert.mockResolvedValueOnce({
      shiftId: 'shift-1',
      tenantId: 'tenant-1',
    });

    const shift = await service.getShift('tenant-1', 'shift-1');
    expect(shift).toBeDefined();
    expect(mockNatsClient.getShift).toHaveBeenCalledWith('tenant-1', 'shift-1');
    expect(mockPrisma.shiftSnapshot.upsert).toHaveBeenCalled();
  });

  it('ignores stale updates when incoming version is lower than stored', async () => {
    mockPrisma.shiftSnapshot.findFirst.mockResolvedValueOnce({
      shiftId: 'shift-1',
      version: 2,
    });

    await service.upsertShift({
      ...mockShift,
      version: 1, // stale
    });

    expect(mockPrisma.shiftSnapshot.upsert).not.toHaveBeenCalled();
  });

  describe('findMatchingShiftForClockIn', () => {
    const shift = {
      shiftId: 'shift-1',
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      siteId: 'site-1',
      startsAt: new Date('2026-10-28T09:00:00.000Z'),
      endsAt: new Date('2026-10-28T17:00:00.000Z'),
      status: 'SCHEDULED',
    };

    beforeEach(() => {
      mockPrisma.shiftSnapshot.findMany.mockResolvedValue([shift]);
    });

    it('matches clock-in 60 minutes before shift start', async () => {
      const deviceTime = new Date('2026-10-28T08:00:00.000Z'); // Exactly 60 min before
      const matched = await service.findMatchingShiftForClockIn(
        'tenant-1',
        'emp-1',
        'site-1',
        deviceTime,
      );

      expect(matched).toBeDefined();
      expect(matched?.shiftId).toBe('shift-1');
    });

    it('rejects clock-in 61 minutes before shift start (outside window)', async () => {
      const deviceTime = new Date('2026-10-28T07:59:00.000Z'); // 61 min before
      const matched = await service.findMatchingShiftForClockIn(
        'tenant-1',
        'emp-1',
        'site-1',
        deviceTime,
      );

      expect(matched).toBeNull();
    });

    it('matches clock-in at the middle of the shift', async () => {
      const deviceTime = new Date('2026-10-28T12:00:00.000Z');
      const matched = await service.findMatchingShiftForClockIn(
        'tenant-1',
        'emp-1',
        'site-1',
        deviceTime,
      );

      expect(matched).toBeDefined();
    });

    it('rejects clock-in after shift has ended', async () => {
      const deviceTime = new Date('2026-10-28T17:01:00.000Z'); // 1 min after end
      const matched = await service.findMatchingShiftForClockIn(
        'tenant-1',
        'emp-1',
        'site-1',
        deviceTime,
      );

      expect(matched).toBeNull();
    });
  });
});
