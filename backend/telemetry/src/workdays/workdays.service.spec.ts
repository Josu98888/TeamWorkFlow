import { Test, TestingModule } from '@nestjs/testing';
import { WorkdaysService } from './workdays.service';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { JetStreamService } from '../nats/jetstream.service';
import { ShiftSnapshotService } from '../shifts/shift-snapshot.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import { EmployeeCacheService } from '../geofence/employee-cache.service';
import { WorkdayNotFoundException } from '../common/exceptions';
import { WORKDAYS_CONSTANTS, WORKDAYS_EVENTS } from './workdays.patterns';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

describe('WorkdaysService', () => {
  let service: WorkdaysService;

  const mockPrisma = {
    workday: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
    },
    clockEvent: {
      findMany: jest.fn(),
    },
    alert: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockJetstream = {
    publish: jest.fn(),
  };

  const mockShifts = {
    getShift: jest.fn(),
  };

  const mockTenantState = {
    hasFeature: jest.fn(),
    isSuspended: jest.fn(),
  };

  const mockEmployeeCache = {
    getEmployee: jest.fn(),
  };

  const mockActor: VerifiedActor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'employee',
    siteIds: ['site-1'],
    tenantStatus: 'active',
    plan: 'pro',
    features: { alerts: true, tower: true },
  };

  const mockSupervisorActor: VerifiedActor = {
    userId: 'user-sup',
    tenantId: 'tenant-1',
    role: 'supervisor',
    siteIds: ['site-1'],
    tenantStatus: 'active',
    plan: 'pro',
    features: { alerts: true, tower: true },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: any) => Promise<any>) =>
      cb(mockPrisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkdaysService,
        { provide: AttendancePrismaService, useValue: mockPrisma },
        { provide: JetStreamService, useValue: mockJetstream },
        { provide: ShiftSnapshotService, useValue: mockShifts },
        { provide: TenantStateService, useValue: mockTenantState },
        { provide: EmployeeCacheService, useValue: mockEmployeeCache },
      ],
    }).compile();

    service = module.get<WorkdaysService>(WorkdaysService);
  });

  describe('recomputeWorkday', () => {
    const shiftStart = new Date('2026-10-28T08:00:00Z');
    const shiftEnd = new Date('2026-10-28T16:00:00Z'); // 8 hours = 480 min

    const mockShift = {
      shiftId: 'shift-1',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      employeeId: 'emp-1',
      startsAt: shiftStart,
      endsAt: shiftEnd,
    };

    it('returns null if shift snapshot is not found', async () => {
      mockShifts.getShift.mockResolvedValue(null);

      const result = await service.recomputeWorkday('tenant-1', 'shift-unknown');
      expect(result).toBeNull();
    });

    it('returns null if shift has no employee assigned and no clock events', async () => {
      mockShifts.getShift.mockResolvedValue({
        ...mockShift,
        employeeId: null,
      });
      mockPrisma.clockEvent.findMany.mockResolvedValue([]);

      const result = await service.recomputeWorkday('tenant-1', 'shift-1');
      expect(result).toBeNull();
    });

    it('calculates workedMinutes, overtimeMinutes, lateMinutes and closes workday on OUT', async () => {
      mockShifts.getShift.mockResolvedValue(mockShift);

      // In at 08:15 (15 min late), Break 12:00 to 12:30 (30 min), Out at 17:00 (8h45m total span - 30 min break = 8h15m = 495 min)
      // Shift is 8 hours (480 min) -> overtime = 495 - 480 = 15 min
      const events = [
        {
          type: 'IN',
          deviceTime: new Date('2026-10-28T08:15:00Z'),
          employeeId: 'emp-1',
        },
        {
          type: 'BREAK_START',
          deviceTime: new Date('2026-10-28T12:00:00Z'),
          employeeId: 'emp-1',
        },
        {
          type: 'BREAK_END',
          deviceTime: new Date('2026-10-28T12:30:00Z'),
          employeeId: 'emp-1',
        },
        {
          type: 'OUT',
          deviceTime: new Date('2026-10-28T17:00:00Z'),
          employeeId: 'emp-1',
        },
      ];
      mockPrisma.clockEvent.findMany.mockResolvedValue(events);
      mockPrisma.workday.findUnique.mockResolvedValue({
        id: 'wd-1',
        status: 'OPEN',
      });

      const savedWorkday = {
        id: 'wd-1',
        tenantId: 'tenant-1',
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        siteId: 'site-1',
        workedMinutes: 495,
        overtimeMinutes: 15,
        lateMinutes: 15,
        status: 'CLOSED',
        updatedAt: new Date(),
      };
      mockPrisma.workday.upsert.mockResolvedValue(savedWorkday);

      const result = await service.recomputeWorkday('tenant-1', 'shift-1');

      expect(result).toEqual(savedWorkday);
      expect(mockPrisma.workday.upsert).toHaveBeenCalledWith({
        where: {
          tenantId_shiftId: {
            tenantId: 'tenant-1',
            shiftId: 'shift-1',
          },
        },
        create: expect.objectContaining({
          workedMinutes: 495,
          overtimeMinutes: 15,
          lateMinutes: 15,
          status: 'CLOSED',
        }),
        update: expect.objectContaining({
          workedMinutes: 495,
          overtimeMinutes: 15,
          lateMinutes: 15,
          status: 'CLOSED',
        }),
      });

      // Auto-resolves any open MISSING_CLOCK_OUT alert
      expect(mockPrisma.alert.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          shiftId: 'shift-1',
          type: 'MISSING_CLOCK_OUT',
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        },
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedBy: 'system',
        }),
      });

      // Emits workday_closed event
      expect(mockJetstream.publish).toHaveBeenCalledWith(
        'tenant-1',
        WORKDAYS_EVENTS.CLOSED,
        expect.objectContaining({
          workdayId: 'wd-1',
          shiftId: 'shift-1',
          workedMinutes: 495,
          overtimeMinutes: 15,
        }),
      );
    });

    it('marks workday as MISSING_CLOCK_OUT, zeros workedMinutes and creates alert after shift end + 2 hours with open IN', async () => {
      // Shift ended 3 hours ago
      const pastShiftEnd = new Date(
        Date.now() - (WORKDAYS_CONSTANTS.MISSING_CLOCK_OUT_HOURS + 1) * 3600 * 1000,
      );
      const pastShiftStart = new Date(pastShiftEnd.getTime() - 8 * 3600 * 1000);

      mockShifts.getShift.mockResolvedValue({
        ...mockShift,
        startsAt: pastShiftStart,
        endsAt: pastShiftEnd,
      });

      // Has IN, no OUT
      mockPrisma.clockEvent.findMany.mockResolvedValue([
        {
          type: 'IN',
          deviceTime: pastShiftStart,
          employeeId: 'emp-1',
        },
      ]);
      mockPrisma.workday.findUnique.mockResolvedValue(null);
      mockTenantState.hasFeature.mockResolvedValue(true);
      mockTenantState.isSuspended.mockResolvedValue(false);
      mockPrisma.alert.findFirst.mockResolvedValue(null);

      const savedWorkday = {
        id: 'wd-missing',
        tenantId: 'tenant-1',
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        siteId: 'site-1',
        workedMinutes: 0,
        overtimeMinutes: 0,
        lateMinutes: 0,
        status: 'MISSING_CLOCK_OUT',
        updatedAt: new Date(),
      };
      mockPrisma.workday.upsert.mockResolvedValue(savedWorkday);

      const result = await service.recomputeWorkday('tenant-1', 'shift-1');

      expect(result?.status).toBe('MISSING_CLOCK_OUT');
      expect(mockPrisma.workday.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            workedMinutes: 0,
            overtimeMinutes: 0,
            status: 'MISSING_CLOCK_OUT',
          }),
        }),
      );

      expect(mockPrisma.alert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          shiftId: 'shift-1',
          type: 'MISSING_CLOCK_OUT',
          status: 'OPEN',
        }),
      });
    });

    it('keeps status as OPEN before shift end + 2 hours when IN has no OUT', async () => {
      // Shift ends 1 hour in the future
      const futureShiftEnd = new Date(Date.now() + 3600 * 1000);
      const shiftStart = new Date(Date.now() - 3600 * 1000);

      mockShifts.getShift.mockResolvedValue({
        ...mockShift,
        startsAt: shiftStart,
        endsAt: futureShiftEnd,
      });

      mockPrisma.clockEvent.findMany.mockResolvedValue([
        {
          type: 'IN',
          deviceTime: shiftStart,
          employeeId: 'emp-1',
        },
      ]);

      const savedWorkday = {
        id: 'wd-open',
        status: 'OPEN',
      };
      mockPrisma.workday.upsert.mockResolvedValue(savedWorkday);

      const result = await service.recomputeWorkday('tenant-1', 'shift-1');
      expect(result?.status).toBe('OPEN');
      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });
  });

  describe('getWorkdayByShiftId', () => {
    it('throws WorkdayNotFoundException if workday does not exist', async () => {
      mockPrisma.workday.findUnique.mockResolvedValue(null);

      await expect(
        service.getWorkdayByShiftId(mockActor, 'shift-unknown'),
      ).rejects.toThrow(WorkdayNotFoundException);
    });

    it('throws WorkdayNotFoundException if employee tries to read another employee workday', async () => {
      mockPrisma.workday.findUnique.mockResolvedValue({
        id: 'wd-1',
        tenantId: 'tenant-1',
        shiftId: 'shift-1',
        employeeId: 'emp-other',
        siteId: 'site-1',
      });
      mockEmployeeCache.getEmployee.mockResolvedValue({
        id: 'emp-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });

      await expect(
        service.getWorkdayByShiftId(mockActor, 'shift-1'),
      ).rejects.toThrow(WorkdayNotFoundException);
    });

    it('throws WorkdayNotFoundException if supervisor is not assigned to site', async () => {
      mockPrisma.workday.findUnique.mockResolvedValue({
        id: 'wd-1',
        tenantId: 'tenant-1',
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        siteId: 'site-other',
      });

      await expect(
        service.getWorkdayByShiftId(mockSupervisorActor, 'shift-1'),
      ).rejects.toThrow(WorkdayNotFoundException);
    });

    it('returns workday when supervisor is assigned to site', async () => {
      const workday = {
        id: 'wd-1',
        tenantId: 'tenant-1',
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        siteId: 'site-1',
      };
      mockPrisma.workday.findUnique.mockResolvedValue(workday);

      const result = await service.getWorkdayByShiftId(
        mockSupervisorActor,
        'shift-1',
      );
      expect(result).toEqual(workday);
    });
  });

  describe('listWorkdays', () => {
    it('scopes list query to employeeId for employee actor', async () => {
      mockEmployeeCache.getEmployee.mockResolvedValue({
        id: 'emp-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      mockPrisma.workday.findMany.mockResolvedValue([]);
      mockPrisma.workday.count.mockResolvedValue(0);

      await service.listWorkdays(mockActor, { page: 1, pageSize: 10 });

      expect(mockPrisma.workday.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          employeeId: 'emp-1',
        }),
        orderBy: { updatedAt: 'desc' },
        skip: 0,
        take: 10,
      });
    });

    it('scopes list query to supervisor siteIds', async () => {
      mockPrisma.workday.findMany.mockResolvedValue([]);
      mockPrisma.workday.count.mockResolvedValue(0);

      await service.listWorkdays(mockSupervisorActor, {});

      expect(mockPrisma.workday.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          siteId: { in: ['site-1'] },
        }),
        orderBy: { updatedAt: 'desc' },
        skip: 0,
        take: 20,
      });
    });
  });
});
