import { TenantStateService } from './tenant-state.service';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';

describe('TenantStateService', () => {
  let service: TenantStateService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tenantState: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
      tenantFeatures: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
    };
    service = new TenantStateService(
      mockPrisma as unknown as AttendancePrismaService,
    );
  });

  describe('isSuspended', () => {
    it('returns false when no tenantState row exists (active by default)', async () => {
      mockPrisma.tenantState.findFirst.mockResolvedValueOnce(null);
      const isSusp = await service.isSuspended('tenant-1');
      expect(isSusp).toBe(false);
    });

    it('returns true when tenantState has isSuspended: true', async () => {
      mockPrisma.tenantState.findFirst.mockResolvedValueOnce({
        tenantId: 'tenant-1',
        isSuspended: true,
      });
      const isSusp = await service.isSuspended('tenant-1');
      expect(isSusp).toBe(true);
    });
  });

  describe('hasFeature', () => {
    it('returns false (fail-closed) when no features row exists', async () => {
      mockPrisma.tenantFeatures.findFirst.mockResolvedValueOnce(null);
      const hasAlerts = await service.hasFeature('tenant-1', 'alerts');
      expect(hasAlerts).toBe(false);
    });

    it('returns true when features contains feature: true', async () => {
      mockPrisma.tenantFeatures.findFirst.mockResolvedValueOnce({
        tenantId: 'tenant-1',
        features: { alerts: true, tower: false },
      });
      const hasAlerts = await service.hasFeature('tenant-1', 'alerts');
      const hasTower = await service.hasFeature('tenant-1', 'tower');

      expect(hasAlerts).toBe(true);
      expect(hasTower).toBe(false);
    });
  });

  describe('updateFeatures', () => {
    it('ignores stale updates when effectiveAt is older than stored', async () => {
      mockPrisma.tenantFeatures.findFirst.mockResolvedValueOnce({
        tenantId: 'tenant-1',
        effectiveAt: new Date('2026-10-28T12:00:00Z'),
      });

      await service.updateFeatures(
        'tenant-1',
        { alerts: true },
        new Date('2026-10-28T11:00:00Z'), // stale
      );

      expect(mockPrisma.tenantFeatures.upsert).not.toHaveBeenCalled();
    });

    it('upserts features when effectiveAt is newer', async () => {
      mockPrisma.tenantFeatures.findFirst.mockResolvedValueOnce({
        tenantId: 'tenant-1',
        effectiveAt: new Date('2026-10-28T10:00:00Z'),
      });

      await service.updateFeatures(
        'tenant-1',
        { alerts: true, tower: true },
        new Date('2026-10-28T12:00:00Z'),
      );

      expect(mockPrisma.tenantFeatures.upsert).toHaveBeenCalled();
    });
  });
});
