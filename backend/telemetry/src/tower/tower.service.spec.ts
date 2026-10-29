import { Test, TestingModule } from '@nestjs/testing';
import { TowerService } from './tower.service';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { JetStreamService } from '../nats/jetstream.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import { TowerGateway } from './tower.gateway';
import { TOWER_EVENTS } from './tower.patterns';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

describe('TowerService', () => {
  let service: TowerService;

  const mockPrisma = {
    shiftSnapshot: {
      findMany: jest.fn(),
    },
    clockEvent: {
      findMany: jest.fn(),
    },
    alert: {
      count: jest.fn(),
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

  const mockGateway = {
    broadcastSiteSummary: jest.fn(),
  };

  const mockSupervisorActor: VerifiedActor = {
    userId: 'user-sup',
    tenantId: 'tenant-1',
    role: 'supervisor',
    siteIds: ['site-1', 'site-2'],
    tenantStatus: 'active',
    plan: 'pro',
    features: { alerts: true, tower: true },
  };

  const mockAdminActor: VerifiedActor = {
    userId: 'user-admin',
    tenantId: 'tenant-1',
    role: 'admin',
    siteIds: [],
    tenantStatus: 'active',
    plan: 'pro',
    features: { alerts: true, tower: true },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TowerService,
        { provide: AttendancePrismaService, useValue: mockPrisma },
        { provide: JetStreamService, useValue: mockJetstream },
        { provide: TenantStateService, useValue: mockTenantState },
        { provide: TowerGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<TowerService>(TowerService);
  });

  describe('getSiteSummary', () => {
    it('computes expected, present, and openAlerts correctly', async () => {
      const now = new Date('2026-10-28T12:00:00Z');

      // 2 shifts in progress: 1 with employee, 1 uncovered (no employee)
      mockPrisma.shiftSnapshot.findMany.mockResolvedValue([
        {
          shiftId: 'shift-1',
          employeeId: 'emp-1',
          siteId: 'site-1',
        },
        {
          shiftId: 'shift-2',
          employeeId: null,
          siteId: 'site-1',
        },
      ]);

      // Shift 1 has an IN without OUT -> present
      mockPrisma.clockEvent.findMany
        .mockResolvedValueOnce([
          { type: 'IN', deviceTime: new Date('2026-10-28T08:00:00Z') },
        ])
        // Shift 2 has no clock events
        .mockResolvedValueOnce([]);

      mockPrisma.alert.count.mockResolvedValue(2);

      const summary = await service.getSiteSummary('tenant-1', 'site-1', now);

      expect(summary).toEqual({
        siteId: 'site-1',
        expected: 1, // Only shift-1 has employeeId
        present: 1, // shift-1 has open IN
        openAlerts: 2,
      });
    });
  });

  describe('emitSiteSummaryUpdated', () => {
    it('returns null if tower feature is disabled or tenant is suspended', async () => {
      mockTenantState.hasFeature.mockResolvedValue(false);
      mockTenantState.isSuspended.mockResolvedValue(false);

      const result = await service.emitSiteSummaryUpdated('tenant-1', 'site-1');
      expect(result).toBeNull();
      expect(mockJetstream.publish).not.toHaveBeenCalled();
      expect(mockGateway.broadcastSiteSummary).not.toHaveBeenCalled();
    });

    it('publishes JetStream event and broadcasts to WebSocket rooms when tower feature is active', async () => {
      const now = new Date('2026-10-28T12:00:00Z');
      mockTenantState.hasFeature.mockResolvedValue(true);
      mockTenantState.isSuspended.mockResolvedValue(false);

      mockPrisma.shiftSnapshot.findMany.mockResolvedValue([]);
      mockPrisma.alert.count.mockResolvedValue(0);

      const result = await service.emitSiteSummaryUpdated(
        'tenant-1',
        'site-1',
        now,
      );

      expect(result).toEqual({
        siteId: 'site-1',
        expected: 0,
        present: 0,
        openAlerts: 0,
      });

      expect(mockJetstream.publish).toHaveBeenCalledWith(
        'tenant-1',
        TOWER_EVENTS.SITE_SUMMARY_UPDATED,
        expect.objectContaining({
          siteId: 'site-1',
          expected: 0,
          present: 0,
          openAlerts: 0,
        }),
      );

      expect(mockGateway.broadcastSiteSummary).toHaveBeenCalledWith(
        'tenant-1',
        'site-1',
        expect.objectContaining({ siteId: 'site-1' }),
      );
    });
  });

  describe('getSnapshot', () => {
    it('scopes snapshot to supervisor siteIds', async () => {
      mockPrisma.shiftSnapshot.findMany.mockResolvedValue([]);
      mockPrisma.alert.count.mockResolvedValue(0);
      mockPrisma.alert.findMany.mockResolvedValue([]);

      const snapshot = await service.getSnapshot(mockSupervisorActor);

      expect(snapshot.items).toHaveLength(2);
      expect(snapshot.items.map((i) => i.siteId)).toEqual(['site-1', 'site-2']);
      expect(mockPrisma.shiftSnapshot.findMany).toHaveBeenCalled();
    });

    it('returns all tenant sites for admin actor', async () => {
      mockPrisma.shiftSnapshot.findMany
        .mockResolvedValueOnce([{ siteId: 'site-10' }]) // distinct sites
        .mockResolvedValue([]); // active shifts per site
      mockPrisma.alert.count.mockResolvedValue(0);
      mockPrisma.alert.findMany.mockResolvedValue([]);

      const snapshot = await service.getSnapshot(mockAdminActor);

      expect(snapshot.items).toHaveLength(1);
      expect(snapshot.items[0]?.siteId).toBe('site-10');
    });
  });
});
