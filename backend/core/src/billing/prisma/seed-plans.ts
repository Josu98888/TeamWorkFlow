import { PrismaClient } from './generated/client';

export const INITIAL_PLANS = [
  {
    code: 'BASIC' as const,
    name: 'Plan Básico',
    monthlyPrice: 50000,
    features: { tasks: false, alerts: false, tower: false },
    isActive: true,
  },
  {
    code: 'PRO' as const,
    name: 'Plan Profesional',
    monthlyPrice: 100000,
    features: { tasks: true, alerts: true, tower: true },
    isActive: true,
  },
];

export async function seedPlans(prisma: Pick<PrismaClient, 'plan'>) {
  for (const plan of INITIAL_PLANS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        features: plan.features,
        isActive: plan.isActive,
      },
      create: {
        code: plan.code,
        name: plan.name,
        monthlyPrice: plan.monthlyPrice,
        features: plan.features,
        isActive: plan.isActive,
      },
    });
  }
}
