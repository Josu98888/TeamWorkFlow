import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import {
  ForbiddenException,
  PlanNotFoundException,
} from '../../common/exceptions/app.exceptions';
import { BillingPrismaService } from '../prisma/prisma.service';
import type { PlanCode } from '../prisma/generated/client';

export interface PlanDto {
  code: string;
  name: string;
  monthlyPrice: string;
  features: Record<string, boolean>;
  isActive: boolean;
}

export interface UpdatePlanInput {
  monthlyPrice?: string | Decimal | number;
  features?: Record<string, boolean>;
  name?: string;
  isActive?: boolean;
}

export interface ServiceActor {
  userId: string;
  tenantId: string | null;
  role: string;
}

@Injectable()
export class PlansService {
  constructor(private readonly prisma: BillingPrismaService) {}

  async listPlans(): Promise<PlanDto[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    return plans.map((p) => ({
      code: p.code.toLowerCase(),
      name: p.name,
      monthlyPrice: p.monthlyPrice.toFixed(2),
      features: p.features as Record<string, boolean>,
      isActive: p.isActive,
    }));
  }

  async getPlanByCode(code: string): Promise<PlanDto> {
    const plan = await this.prisma.plan.findUnique({
      where: { code: code.toUpperCase() as PlanCode },
    });

    if (!plan) {
      throw new PlanNotFoundException();
    }

    return {
      code: plan.code.toLowerCase(),
      name: plan.name,
      monthlyPrice: plan.monthlyPrice.toFixed(2),
      features: plan.features as Record<string, boolean>,
      isActive: plan.isActive,
    };
  }

  async updatePlan(
    actor: ServiceActor,
    code: string,
    input: UpdatePlanInput,
  ): Promise<PlanDto> {
    if (actor.role !== 'platform_admin') {
      throw new ForbiddenException();
    }

    const planCode = code.toUpperCase() as PlanCode;
    const existing = await this.prisma.plan.findUnique({
      where: { code: planCode },
    });

    if (!existing) {
      throw new PlanNotFoundException();
    }

    const updated = await this.prisma.plan.update({
      where: { code: planCode },
      data: {
        monthlyPrice:
          input.monthlyPrice !== undefined
            ? new Decimal(input.monthlyPrice)
            : undefined,
        features: input.features !== undefined ? input.features : undefined,
        name: input.name !== undefined ? input.name : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
      },
    });

    return {
      code: updated.code.toLowerCase(),
      name: updated.name,
      monthlyPrice: updated.monthlyPrice.toFixed(2),
      features: updated.features as Record<string, boolean>,
      isActive: updated.isActive,
    };
  }
}
