import { Test, TestingModule } from '@nestjs/testing';
import { ClockInsService } from './clock-ins.service';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { JetStreamService } from '../nats/jetstream.service';
import { GeofenceService } from '../geofence/geofence.service';
import { EmployeeCacheService } from '../geofence/employee-cache.service';
import { ShiftSnapshotService } from '../shifts/shift-snapshot.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import {
  ClockEventNotFoundException,
  ClockTooOldException,
  ForbiddenException,
  NoMatchingShiftException,
} from '../common/exceptions';
import {
  ClockEventMethodDto,
  ClockEventTypeDto,
  CreateClockEventDto,
  CreateManualClockEventDto,
  CorrectClockEventDto,
} from './dto';
import { CLOCK_INS_EVENTS } from './clock-ins.patterns';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

describe('ClockInsService', () => {
  let service: ClockInsService;

  const mockPrisma = {
    clockEvent: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    clockEventCorrection: {
      create: jest.fn(),
    },
    alert: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockJetstream = {
    publish: jest.fn(),
  };

  const mockGeofence = {
    checkLocation: jest.fn(),
  };

  const mockEmployeeCache = {
    getEmployee: jest.fn(),
  };

  const mockShifts = {
    findMatchingShiftForClockIn: jest.fn(),
    getShift: jest.fn(),
  };

  const mockTenantState = {
    hasFeature: jest.fn(),
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
        ClockInsService,
        { provide: AttendancePrismaService, useValue: mockPrisma },
        { provide: JetStreamService, useValue: mockJetstream },
        { provide: GeofenceService, useValue: mockGeofence },
        { provide: EmployeeCacheService, useValue: mockEmployeeCache },
        { provide: ShiftSnapshotService, useValue: mockShifts },
        { provide: TenantStateService, useValue: mockTenantState },
      ],
    }).compile();

    service = module.get<ClockInsService>(ClockInsService);
  });

  describe('createClockEvent', () => {
    const validDto: CreateClockEventDto = {
      clientEventId: 'client-evt-1',
      type: ClockEventTypeDto.IN,
      method: ClockEventMethodDto.GPS,
      siteId: 'site-1',
      deviceTime: new Date().toISOString(),
      latitude: -34.6037,
      longitude: -58.3816,
    };

    it('throws ForbiddenException if employee record is not found', async () => {
      mockEmployeeCache.getEmployee.mockResolvedValue(null);

      await expect(
        service.createClockEvent(mockActor, validDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns existing event on idempotency match (same clientEventId)', async () => {
      mockEmployeeCache.getEmployee.mockResolvedValue({
        id: 'emp-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      const existingEvent = {
        id: 'evt-existing',
        clientEventId: 'client-evt-1',
      };
      mockPrisma.clockEvent.findUnique.mockResolvedValue(existingEvent);

      const result = await service.createClockEvent(mockActor, validDto);
      expect(result).toEqual(existingEvent);
      expect(mockPrisma.clockEvent.create).not.toHaveBeenCalled();
    });

    it('throws ClockTooOldException if deviceTime is older than 24 hours', async () => {
      mockEmployeeCache.getEmployee.mockResolvedValue({
        id: 'emp-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      mockPrisma.clockEvent.findUnique.mockResolvedValue(null);

      const oldDto: CreateClockEventDto = Object.assign({}, validDto, {
        deviceTime: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      });

      await expect(
        service.createClockEvent(mockActor, oldDto),
      ).rejects.toThrow(ClockTooOldException);
    });

    it('throws NoMatchingShiftException if IN has no matching shift', async () => {
      mockEmployeeCache.getEmployee.mockResolvedValue({
        id: 'emp-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      mockPrisma.clockEvent.findUnique.mockResolvedValue(null);
      mockShifts.findMatchingShiftForClockIn.mockResolvedValue(null);

      await expect(
        service.createClockEvent(mockActor, validDto),
      ).rejects.toThrow(NoMatchingShiftException);
    });

    it('successfully creates an IN clock event inside geofence', async () => {
      mockEmployeeCache.getEmployee.mockResolvedValue({
        id: 'emp-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      mockPrisma.clockEvent.findUnique.mockResolvedValue(null);
      mockShifts.findMatchingShiftForClockIn.mockResolvedValue({
        shiftId: 'shift-1',
        siteId: 'site-1',
      });
      mockGeofence.checkLocation.mockResolvedValue({
        valid: true,
        outOfGeofence: false,
        distanceMeters: 25,
      });

      const savedRecord = {
        id: 'evt-1',
        tenantId: 'tenant-1',
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        siteId: 'site-1',
        type: 'IN',
        method: 'GPS',
        outOfGeofence: false,
        receivedAt: new Date(),
      };
      mockPrisma.clockEvent.create.mockResolvedValue(savedRecord);

      const result = await service.createClockEvent(mockActor, validDto);

      expect(result).toEqual(savedRecord);
      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
      expect(mockJetstream.publish).toHaveBeenCalledWith(
        'tenant-1',
        CLOCK_INS_EVENTS.RECORDED,
        expect.objectContaining({
          clockEventId: 'evt-1',
          type: 'in',
          outOfGeofence: false,
        }),
      );
    });

    it('accepts out of geofence IN event and opens OUT_OF_GEOFENCE alert if plan has alerts', async () => {
      mockEmployeeCache.getEmployee.mockResolvedValue({
        id: 'emp-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      mockPrisma.clockEvent.findUnique.mockResolvedValue(null);
      mockShifts.findMatchingShiftForClockIn.mockResolvedValue({
        shiftId: 'shift-1',
        siteId: 'site-1',
      });
      mockGeofence.checkLocation.mockResolvedValue({
        valid: true,
        outOfGeofence: true,
        distanceMeters: 350,
      });
      mockTenantState.hasFeature.mockResolvedValue(true);

      const savedRecord = {
        id: 'evt-2',
        tenantId: 'tenant-1',
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        siteId: 'site-1',
        type: 'IN',
        method: 'GPS',
        outOfGeofence: true,
        receivedAt: new Date(),
      };
      mockPrisma.clockEvent.create.mockResolvedValue(savedRecord);

      const result = await service.createClockEvent(mockActor, validDto);

      expect(result.outOfGeofence).toBe(true);
      expect(mockPrisma.alert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'OUT_OF_GEOFENCE',
          clockEventId: 'evt-2',
        }),
      });
    });

    it('matches open IN for OUT clock event', async () => {
      mockEmployeeCache.getEmployee.mockResolvedValue({
        id: 'emp-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      mockPrisma.clockEvent.findUnique.mockResolvedValue(null);
      mockPrisma.clockEvent.findMany.mockResolvedValue([
        { shiftId: 'shift-1', deviceTime: new Date() },
      ]);
      mockPrisma.clockEvent.findFirst.mockResolvedValue(null); // No OUT exists for this IN
      mockGeofence.checkLocation.mockResolvedValue({
        valid: true,
        outOfGeofence: false,
        distanceMeters: 10,
      });

      const outDto: CreateClockEventDto = Object.assign({}, validDto, {
        clientEventId: 'client-evt-out',
        type: ClockEventTypeDto.OUT,
      });

      const savedRecord = {
        id: 'evt-out',
        tenantId: 'tenant-1',
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        siteId: 'site-1',
        type: 'OUT',
        method: 'GPS',
        outOfGeofence: false,
        receivedAt: new Date(),
      };
      mockPrisma.clockEvent.create.mockResolvedValue(savedRecord);

      const result = await service.createClockEvent(mockActor, outDto);
      expect(result.type).toBe('OUT');
    });

    it('throws NoMatchingShiftException if OUT event has no open IN', async () => {
      mockEmployeeCache.getEmployee.mockResolvedValue({
        id: 'emp-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      mockPrisma.clockEvent.findUnique.mockResolvedValue(null);
      mockPrisma.clockEvent.findMany.mockResolvedValue([]);

      const outDto: CreateClockEventDto = Object.assign({}, validDto, {
        type: ClockEventTypeDto.OUT,
      });

      await expect(
        service.createClockEvent(mockActor, outDto),
      ).rejects.toThrow(NoMatchingShiftException);
    });
  });

  describe('createManualClockEvent', () => {
    const manualDto: CreateManualClockEventDto = {
      employeeId: 'emp-1',
      shiftId: 'shift-1',
      type: ClockEventTypeDto.IN,
      time: new Date().toISOString(),
      reason: 'Employee forgot phone',
    };

    it('throws NoMatchingShiftException if shift is not found', async () => {
      mockShifts.getShift.mockResolvedValue(null);

      await expect(
        service.createManualClockEvent(mockSupervisorActor, manualDto),
      ).rejects.toThrow(NoMatchingShiftException);
    });

    it('throws ClockEventNotFoundException if supervisor is not assigned to site', async () => {
      mockShifts.getShift.mockResolvedValue({
        shiftId: 'shift-1',
        siteId: 'site-other',
      });

      await expect(
        service.createManualClockEvent(mockSupervisorActor, manualDto),
      ).rejects.toThrow(ClockEventNotFoundException);
    });

    it('creates manual clock event with audit data and publishes JetStream event', async () => {
      mockShifts.getShift.mockResolvedValue({
        shiftId: 'shift-1',
        siteId: 'site-1',
      });

      const savedEvent = {
        id: 'evt-manual-1',
        tenantId: 'tenant-1',
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        siteId: 'site-1',
        type: 'IN',
        method: 'MANUAL',
        receivedAt: new Date(),
        reason: 'Employee forgot phone',
      };
      mockPrisma.clockEvent.create.mockResolvedValue(savedEvent);

      const result = await service.createManualClockEvent(
        mockSupervisorActor,
        manualDto,
      );

      expect(result).toEqual(savedEvent);
      expect(mockJetstream.publish).toHaveBeenCalledWith(
        'tenant-1',
        CLOCK_INS_EVENTS.RECORDED,
        expect.objectContaining({
          clockEventId: 'evt-manual-1',
          method: 'manual',
        }),
      );
    });
  });

  describe('correctClockEvent', () => {
    const correctDto: CorrectClockEventDto = {
      type: ClockEventTypeDto.OUT,
      reason: 'Wrong type was registered by employee',
    };

    it('throws ClockEventNotFoundException if clock event does not exist', async () => {
      mockPrisma.clockEvent.findFirst.mockResolvedValue(null);

      await expect(
        service.correctClockEvent(mockSupervisorActor, 'evt-unknown', correctDto),
      ).rejects.toThrow(ClockEventNotFoundException);
    });

    it('throws ClockEventNotFoundException if supervisor is not assigned to site', async () => {
      mockPrisma.clockEvent.findFirst.mockResolvedValue({
        id: 'evt-1',
        tenantId: 'tenant-1',
        siteId: 'site-other',
      });

      await expect(
        service.correctClockEvent(mockSupervisorActor, 'evt-1', correctDto),
      ).rejects.toThrow(ClockEventNotFoundException);
    });

    it('records correction audit trail and updates clock event', async () => {
      const existing = {
        id: 'evt-1',
        tenantId: 'tenant-1',
        siteId: 'site-1',
        shiftId: 'shift-1',
        type: 'IN',
        deviceTime: new Date('2026-10-28T10:00:00Z'),
      };
      mockPrisma.clockEvent.findFirst.mockResolvedValue(existing);

      const updated = {
        ...existing,
        type: 'OUT',
      };
      mockPrisma.clockEvent.update.mockResolvedValue(updated);

      const result = await service.correctClockEvent(
        mockSupervisorActor,
        'evt-1',
        correctDto,
      );

      expect(result.type).toBe('OUT');
      expect(mockPrisma.clockEventCorrection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          clockEventId: 'evt-1',
          reason: 'Wrong type was registered by employee',
          correctedByUserId: 'user-sup',
        }),
      });
      expect(mockJetstream.publish).toHaveBeenCalledWith(
        'tenant-1',
        CLOCK_INS_EVENTS.CORRECTED,
        expect.objectContaining({
          clockEventId: 'evt-1',
          actorId: 'user-sup',
        }),
      );
    });
  });

  describe('listClockEvents', () => {
    it('scopes query to employeeId when actor is employee', async () => {
      mockEmployeeCache.getEmployee.mockResolvedValue({
        id: 'emp-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });
      mockPrisma.clockEvent.findMany.mockResolvedValue([]);
      mockPrisma.clockEvent.count.mockResolvedValue(0);

      await service.listClockEvents(mockActor, { page: 1, pageSize: 10 });

      expect(mockPrisma.clockEvent.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          employeeId: 'emp-1',
        }),
        orderBy: { deviceTime: 'desc' },
        skip: 0,
        take: 10,
      });
    });

    it('scopes query to supervisor siteIds when actor is supervisor', async () => {
      mockPrisma.clockEvent.findMany.mockResolvedValue([]);
      mockPrisma.clockEvent.count.mockResolvedValue(0);

      await service.listClockEvents(mockSupervisorActor, {});

      expect(mockPrisma.clockEvent.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          siteId: { in: ['site-1'] },
        }),
        orderBy: { deviceTime: 'desc' },
        skip: 0,
        take: 20,
      });
    });
  });
});
