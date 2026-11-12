import { Decimal } from '@prisma/client/runtime/client';
import {
  ForbiddenException,
  PlanNotFoundException,
} from '../../common/exceptions/app.exceptions';
import { PlansService } from './plans.service';
import type { BillingPrismaService } from '../prisma/prisma.service';

jest.mock('../../config', () => ({ envs: {} }));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

describe('PlansService', () => {
  let service: PlansService;
  let mockPrisma: {
    plan: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  const adminActor = {
    userId: 'admin-1',
    tenantId: null,
    role: 'platform_admin',
  };

  const ownerActor = {
    userId: 'owner-1',
    tenantId: 'tenant-1',
    role: 'owner',
  };

  beforeEach(() => {
    mockPrisma = {
      plan: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new PlansService(mockPrisma as unknown as BillingPrismaService);
  });

  it('listPlans returns active plans formatted correctly', async () => {
    mockPrisma.plan.findMany.mockResolvedValueOnce([
      {
        code: 'BASIC',
        name: 'Plan Básico',
        monthlyPrice: new Decimal('50000.00'),
        features: { tasks: false, alerts: false, tower: false },
        isActive: true,
      },
      {
        code: 'PRO',
        name: 'Plan Profesional',
        monthlyPrice: new Decimal('100000.00'),
        features: { tasks: true, alerts: true, tower: true },
        isActive: true,
      },
    ]);

    const plans = await service.listPlans();

    expect(plans).toHaveLength(2);
    expect(plans[0]).toEqual({
      code: 'basic',
      name: 'Plan Básico',
      monthlyPrice: '50000.00',
      features: { tasks: false, alerts: false, tower: false },
      isActive: true,
    });
    expect(plans[1].monthlyPrice).toBe('100000.00');
  });

  it('getPlanByCode returns single plan or throws 404', async () => {
    mockPrisma.plan.findUnique.mockResolvedValueOnce({
      code: 'PRO',
      name: 'Plan Profesional',
      monthlyPrice: new Decimal('100000.00'),
      features: { tasks: true, alerts: true, tower: true },
      isActive: true,
    });

    const plan = await service.getPlanByCode('pro');
    expect(plan.code).toBe('pro');

    mockPrisma.plan.findUnique.mockResolvedValueOnce(null);
    await expect(service.getPlanByCode('invalid')).rejects.toThrow(
      PlanNotFoundException,
    );
  });

  it('updatePlan rejects non-platform-admin with ForbiddenException', async () => {
    await expect(
      service.updatePlan(ownerActor, 'pro', { monthlyPrice: '120000.00' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('updatePlan throws PlanNotFoundException if plan does not exist', async () => {
    mockPrisma.plan.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.updatePlan(adminActor, 'unknown', { monthlyPrice: '120000.00' }),
    ).rejects.toThrow(PlanNotFoundException);
  });

  it('updatePlan updates monthlyPrice and features successfully', async () => {
    mockPrisma.plan.findUnique.mockResolvedValueOnce({
      code: 'PRO',
      name: 'Plan Profesional',
      monthlyPrice: new Decimal('100000.00'),
      features: { tasks: true, alerts: true, tower: true },
      isActive: true,
    });

    mockPrisma.plan.update.mockResolvedValueOnce({
      code: 'PRO',
      name: 'Plan Profesional',
      monthlyPrice: new Decimal('150000.00'),
      features: { tasks: true, alerts: true, tower: true, newFeature: true },
      isActive: true,
    });

    const updated = await service.updatePlan(adminActor, 'pro', {
      monthlyPrice: '150000.00',
      features: { tasks: true, alerts: true, tower: true, newFeature: true },
    });

    expect(updated.monthlyPrice).toBe('150000.00');
    expect(updated.features).toEqual({
      tasks: true,
      alerts: true,
      tower: true,
      newFeature: true,
    });
  });
});
