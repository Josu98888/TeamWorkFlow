import {
  EmployeeNotFoundException,
  PostNotFoundException,
} from '../common/exceptions';
import { Prisma } from '../prisma/generated/client';
import { CompensationService } from './compensation.service';

describe('CompensationService', () => {
  let service: CompensationService;
  const mockPrisma = {
    employeeSnapshot: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    employeeCompensation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    siteSnapshot: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    postSnapshot: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    postOvertimeRate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    compensationChangeLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockSnapshots = {
    ensureTenantCatalogSynced: jest.fn().mockResolvedValue(undefined),
  };

  const ownerActor = {
    userId: 'user-owner',
    tenantId: 'tenant-1',
    role: 'owner' as const,
    siteIds: [],
    tenantStatus: 'active' as const,
    plan: 'pro' as const,
    features: { alerts: true, tower: true, payroll_reports: true },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(mockPrisma),
    );
    service = new CompensationService(
      mockPrisma as never,
      mockSnapshots as never,
    );
  });

  it('upserts employee compensation using Prisma.Decimal and writes audit log', async () => {
    mockPrisma.employeeSnapshot.findFirst.mockResolvedValue({
      employeeId: 'emp-1',
      tenantId: 'tenant-1',
      firstName: 'Ana',
      lastName: 'Gomez',
      employeeNumber: 'L-1001',
      isActive: true,
    });
    mockPrisma.employeeCompensation.findUnique.mockResolvedValue(null);
    mockPrisma.employeeCompensation.upsert.mockResolvedValue({
      employeeId: 'emp-1',
      payType: 'HOURLY',
      baseRate: new Prisma.Decimal('4500.50'),
      currency: 'ARS',
      updatedAt: new Date('2026-11-22T12:00:00Z'),
    });

    const res = await service.upsertEmployeeCompensation(ownerActor, 'emp-1', {
      payType: 'hourly',
      baseRate: '4500.50',
      reason: 'Acuerdo paritario',
    });

    expect(res.payType).toBe('HOURLY');
    expect(res.baseRate).toBe('4500.50');
    expect(mockPrisma.compensationChangeLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          targetType: 'EMPLOYEE',
          targetId: 'emp-1',
          after: { payType: 'HOURLY', baseRate: '4500.50' },
        }),
      }),
    );
  });

  it('rejects cross-tenant or unknown employee and post with 404', async () => {
    mockPrisma.employeeSnapshot.findFirst.mockResolvedValue(null);
    await expect(
      service.upsertEmployeeCompensation(ownerActor, 'emp-other', {
        payType: 'per_shift',
        baseRate: '25000',
      }),
    ).rejects.toThrow(EmployeeNotFoundException);

    mockPrisma.postSnapshot.findFirst.mockResolvedValue(null);
    await expect(
      service.upsertPostOvertimeRate(ownerActor, 'post-other', {
        overtimeHourlyRate: '6500',
      }),
    ).rejects.toThrow(PostNotFoundException);
  });
});
