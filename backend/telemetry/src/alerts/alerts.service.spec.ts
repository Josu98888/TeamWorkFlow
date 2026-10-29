import { Test, TestingModule } from '@nestjs/testing';
import { AlertsService } from './alerts.service';
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
import { ALERTS_EVENTS } from './alerts.patterns';
import { AlertStatusDto, AlertTypeDto } from './dto';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

describe('AlertsService', () => {
  let service: AlertsService;

  const mockPrisma = {
    alert: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    shiftSnapshot: {
      findMany: jest.fn(),
    },
    clockEvent: {
      findMany: jest.fn(),
    },
  };

  const mockJetstream = {
    publish: jest.fn(),
  };

  const mockTenantState = {
    hasFeature: jest.fn(),
    isSuspended: jest.fn(),
  };

  const mockShifts = {
    getShift: jest.fn(),
  };

  const mockWorkdays = {
    recomputeWorkday: jest.fn(),
  };

  const mockTower = {
    emitSiteSummaryUpdated: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: AttendancePrismaService, useValue: mockPrisma },
        { provide: JetStreamService, useValue: mockJetstream },
        { provide: TenantStateService, useValue: mockTenantState },
        { provide: ShiftSnapshotService, useValue: mockShifts },
        { provide: WorkdaysService, useValue: mockWorkdays },
        { provide: TowerService, useValue: mockTower },
      ],
    }).compile();

    service = module.get<AlertsService>(AlertsService);
  });

  describe('openAlert', () => {
    it('returns null if tenant is suspended or alerts feature is disabled', async () => {
      mockTenantState.hasFeature.mockResolvedValue(false);
      mockTenantState.isSuspended.mockResolvedValue(false);

      const result = await service.openAlert(
        'tenant-1',
        'LATE',
        'site-1',
        'shift-1',
        'emp-1',
      );
      expect(result).toBeNull();
      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });

    it('returns existing alert on idempotency match for (tenantId, shiftId, type)', async () => {
      mockTenantState.hasFeature.mockResolvedValue(true);
      mockTenantState.isSuspended.mockResolvedValue(false);

      const existing = { id: 'alert-1', type: 'LATE', status: 'OPEN' };
      mockPrisma.alert.findFirst.mockResolvedValue(existing);

      const result = await service.openAlert(
        'tenant-1',
        'LATE',
        'site-1',
        'shift-1',
        'emp-1',
      );
      expect(result).toEqual(existing);
      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });

    it('creates alert and publishes alert_opened event', async () => {
      mockTenantState.hasFeature.mockResolvedValue(true);
      mockTenantState.isSuspended.mockResolvedValue(false);
      mockPrisma.alert.findFirst.mockResolvedValue(null);

      const created = {
        id: 'alert-new',
        tenantId: 'tenant-1',
        type: 'LATE',
        status: 'OPEN',
        siteId: 'site-1',
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        clockEventId: null,
        createdAt: new Date(),
      };
      mockPrisma.alert.create.mockResolvedValue(created);

      const result = await service.openAlert(
        'tenant-1',
        'LATE',
        'site-1',
        'shift-1',
        'emp-1',
      );

      expect(result).toEqual(created);
      expect(mockJetstream.publish).toHaveBeenCalledWith(
        'tenant-1',
        ALERTS_EVENTS.OPENED,
        expect.objectContaining({
          alertId: 'alert-new',
          type: 'late',
          status: 'open',
        }),
      );
    });
  });

  describe('acknowledgeAlert', () => {
    it('throws AlertNotFoundException if alert does not exist', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue(null);

      await expect(
        service.acknowledgeAlert(mockSupervisorActor, 'alert-unknown'),
      ).rejects.toThrow(AlertNotFoundException);
    });

    it('throws AlertNotFoundException if supervisor is not assigned to site', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue({
        id: 'alert-1',
        tenantId: 'tenant-1',
        siteId: 'site-other',
        status: 'OPEN',
      });

      await expect(
        service.acknowledgeAlert(mockSupervisorActor, 'alert-1'),
      ).rejects.toThrow(AlertNotFoundException);
    });

    it('throws AlertInvalidTransitionException if alert is not OPEN', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue({
        id: 'alert-1',
        tenantId: 'tenant-1',
        siteId: 'site-1',
        status: 'ACKNOWLEDGED',
      });

      await expect(
        service.acknowledgeAlert(mockSupervisorActor, 'alert-1'),
      ).rejects.toThrow(AlertInvalidTransitionException);
    });

    it('transitions to ACKNOWLEDGED and emits JetStream event', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue({
        id: 'alert-1',
        tenantId: 'tenant-1',
        siteId: 'site-1',
        status: 'OPEN',
      });

      const updated = {
        id: 'alert-1',
        tenantId: 'tenant-1',
        siteId: 'site-1',
        status: 'ACKNOWLEDGED',
        acknowledgedBy: 'user-sup',
        acknowledgedAt: new Date(),
      };
      mockPrisma.alert.update.mockResolvedValue(updated);

      const result = await service.acknowledgeAlert(
        mockSupervisorActor,
        'alert-1',
      );

      expect(result.status).toBe('ACKNOWLEDGED');
      expect(mockJetstream.publish).toHaveBeenCalledWith(
        'tenant-1',
        ALERTS_EVENTS.ACKNOWLEDGED,
        expect.objectContaining({
          alertId: 'alert-1',
          acknowledgedBy: 'user-sup',
        }),
      );
    });
  });

  describe('resolveAlert', () => {
    it('throws AlertInvalidTransitionException if alert is already RESOLVED', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue({
        id: 'alert-1',
        tenantId: 'tenant-1',
        siteId: 'site-1',
        status: 'RESOLVED',
      });

      await expect(
        service.resolveAlert(mockSupervisorActor, 'alert-1'),
      ).rejects.toThrow(AlertInvalidTransitionException);
    });

    it('transitions alert to RESOLVED and emits JetStream event', async () => {
      mockPrisma.alert.findFirst.mockResolvedValue({
        id: 'alert-1',
        tenantId: 'tenant-1',
        siteId: 'site-1',
        status: 'ACKNOWLEDGED',
      });

      const updated = {
        id: 'alert-1',
        tenantId: 'tenant-1',
        siteId: 'site-1',
        status: 'RESOLVED',
        resolvedBy: 'user-sup',
        resolvedAt: new Date(),
      };
      mockPrisma.alert.update.mockResolvedValue(updated);

      const result = await service.resolveAlert(
        mockSupervisorActor,
        'alert-1',
      );

      expect(result.status).toBe('RESOLVED');
      expect(mockJetstream.publish).toHaveBeenCalledWith(
        'tenant-1',
        ALERTS_EVENTS.RESOLVED,
        expect.objectContaining({
          alertId: 'alert-1',
          resolvedBy: 'user-sup',
        }),
      );
    });
  });

  describe('resolveAlertsOnClockIn', () => {
    it('auto-resolves UNCOVERED_POST and LATE alerts on employee clock in', async () => {
      mockPrisma.alert.findMany
        .mockResolvedValueOnce([{ id: 'alert-uncovered' }]) // UNCOVERED_POST
        .mockResolvedValueOnce([{ id: 'alert-late' }]); // LATE
      mockPrisma.alert.update.mockResolvedValue({});

      await service.resolveAlertsOnClockIn('tenant-1', 'shift-1', 'emp-1');

      expect(mockPrisma.alert.update).toHaveBeenCalledWith({
        where: { id: 'alert-uncovered' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedBy: 'system',
        }),
      });

      expect(mockPrisma.alert.update).toHaveBeenCalledWith({
        where: { id: 'alert-late' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedBy: 'system',
        }),
      });

      expect(mockJetstream.publish).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveAlertsOnClockOut', () => {
    it('auto-resolves MISSING_CLOCK_OUT alerts on clock out', async () => {
      mockPrisma.alert.findMany.mockResolvedValue([{ id: 'alert-missing-out' }]);
      mockPrisma.alert.update.mockResolvedValue({});

      await service.resolveAlertsOnClockOut('tenant-1', 'shift-1');

      expect(mockPrisma.alert.update).toHaveBeenCalledWith({
        where: { id: 'alert-missing-out' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedBy: 'system',
        }),
      });

      expect(mockJetstream.publish).toHaveBeenCalledWith(
        'tenant-1',
        ALERTS_EVENTS.RESOLVED,
        expect.objectContaining({
          alertId: 'alert-missing-out',
          resolvedBy: 'system',
        }),
      );
    });
  });

  describe('listAlerts', () => {
    it('throws ForbiddenException if supervisor accesses unauthorized site', async () => {
      await expect(
        service.listAlerts(mockSupervisorActor, { siteId: 'site-unauthorized' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('scopes query to supervisor siteIds', async () => {
      mockPrisma.alert.findMany.mockResolvedValue([]);
      mockPrisma.alert.count.mockResolvedValue(0);

      await service.listAlerts(mockSupervisorActor, {
        status: AlertStatusDto.OPEN,
        type: AlertTypeDto.LATE,
      });

      expect(mockPrisma.alert.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          siteId: { in: ['site-1'] },
          status: 'OPEN',
          type: 'LATE',
        }),
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
    });
  });

  describe('runPeriodicChecks', () => {
    it('detects LATE and UNCOVERED_POST alerts for shifts without IN events', async () => {
      const now = new Date('2026-10-28T09:20:00Z');
      const shiftStart = new Date('2026-10-28T09:00:00Z'); // 20 min ago (>= 10 and >= 15 min)
      const shiftEnd = new Date('2026-10-28T17:00:00Z');

      mockPrisma.shiftSnapshot.findMany
        .mockResolvedValueOnce([{ tenantId: 'tenant-1' }]) // distinct tenants
        .mockResolvedValueOnce([
          {
            shiftId: 'shift-1',
            tenantId: 'tenant-1',
            siteId: 'site-1',
            employeeId: 'emp-1',
            startsAt: shiftStart,
            endsAt: shiftEnd,
            status: 'SCHEDULED',
          },
        ]); // shifts query

      mockTenantState.isSuspended.mockResolvedValue(false);
      mockTenantState.hasFeature.mockResolvedValue(true);
      mockPrisma.clockEvent.findMany.mockResolvedValue([]); // no clock events
      mockPrisma.alert.findFirst.mockResolvedValue(null);
      mockPrisma.alert.create.mockResolvedValue({
        id: 'alert-gen',
        type: 'LATE',
        status: 'OPEN',
        createdAt: new Date(),
      });

      const result = await service.runPeriodicChecks(now);

      expect(result.checkedTenants).toBe(1);
      expect(result.openedAlerts).toBe(2); // 1 LATE + 1 UNCOVERED_POST
    });
  });
});
