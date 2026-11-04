import { Inject, Injectable } from '@nestjs/common';
import {
  ForbiddenException,
  InvalidPlanChangeException,
  InvalidSubscriptionTransitionException,
  NoPendingCancellationException,
  PlanNotFoundException,
  SubscriptionNotFoundException,
} from '../../common/exceptions/app.exceptions';
import { CLOCK_SERVICE } from '../common/clock.service';
import type { ClockService } from '../common/clock.service';
import { BILLING_EVENTS } from '../events/billing.events';
import type { WirePlan } from '../events/billing.events';
import { BillingEventsService } from '../events/billing-events.service';
import { BillingPrismaService } from '../prisma/prisma.service';
import type { PlanCode, SubscriptionStatus } from '../prisma/generated/client';

export interface SubscriptionDto {
  id: string;
  tenantId: string;
  plan: WirePlan;
  status: string;
  trialEndsAt: string | null;
  nextPlan: WirePlan | null;
  cancelAtPeriodEnd: boolean;
  features: Record<string, boolean>;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceActor {
  userId: string;
  tenantId: string | null;
  role: string;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: BillingPrismaService,
    private readonly events: BillingEventsService,
    @Inject(CLOCK_SERVICE) private readonly clock: ClockService,
  ) {}

  async getSubscription(actor: ServiceActor): Promise<SubscriptionDto> {
    if (!actor.tenantId) {
      throw new ForbiddenException();
    }

    const sub = await this.prisma.subscription.findFirst({
      where: {
        tenantId: actor.tenantId,
        status: { not: 'CANCELLED' },
      },
      include: { planRef: true, nextPlanRef: true },
    });

    if (!sub) {
      // Check if there is a cancelled one for history
      const cancelledSub = await this.prisma.subscription.findFirst({
        where: { tenantId: actor.tenantId },
        orderBy: { createdAt: 'desc' },
        include: { planRef: true, nextPlanRef: true },
      });
      if (!cancelledSub) {
        throw new SubscriptionNotFoundException();
      }
      return this.mapToDto(cancelledSub);
    }

    return this.mapToDto(sub);
  }

  async changePlan(
    actor: ServiceActor,
    targetPlan: string,
  ): Promise<SubscriptionDto> {
    if (!actor.tenantId) {
      throw new ForbiddenException();
    }

    const targetCode = targetPlan.toUpperCase() as PlanCode;
    const plan = await this.prisma.plan.findUnique({
      where: { code: targetCode },
    });
    if (!plan || !plan.isActive) {
      throw new PlanNotFoundException();
    }

    const currentSub = await this.prisma.subscription.findFirst({
      where: {
        tenantId: actor.tenantId,
        status: { not: 'CANCELLED' },
      },
      include: { planRef: true },
    });

    if (!currentSub) {
      throw new SubscriptionNotFoundException();
    }

    if (currentSub.plan === targetCode) {
      throw new InvalidPlanChangeException();
    }

    const now = this.clock.now();

    // Upgrade: BASIC -> PRO (applied immediately)
    if (targetCode === 'PRO') {
      const [updatedSub] = await this.prisma.$transaction([
        this.prisma.subscription.update({
          where: { id: currentSub.id },
          data: {
            plan: 'PRO',
            nextPlan: null,
          },
          include: { planRef: true, nextPlanRef: true },
        }),
        this.prisma.subscriptionPlanChange.create({
          data: {
            tenantId: actor.tenantId,
            subscriptionId: currentSub.id,
            fromPlan: currentSub.plan,
            toPlan: 'PRO',
            effectiveAt: now,
          },
        }),
      ]);

      await this.events.publish(actor.tenantId, BILLING_EVENTS.planChanged, {
        plan: 'pro',
        features: plan.features as Record<string, boolean>,
        previousPlan: currentSub.plan.toLowerCase() as WirePlan,
        effectiveAt: now.toISOString(),
      });

      return this.mapToDto(updatedSub);
    }

    // Downgrade: PRO -> BASIC (applied at period end close)
    const updatedSub = await this.prisma.subscription.update({
      where: { id: currentSub.id },
      data: {
        nextPlan: 'BASIC',
      },
      include: { planRef: true, nextPlanRef: true },
    });

    return this.mapToDto(updatedSub);
  }

  async cancelSubscription(actor: ServiceActor): Promise<SubscriptionDto> {
    if (!actor.tenantId) {
      throw new ForbiddenException();
    }

    const sub = await this.prisma.subscription.findFirst({
      where: {
        tenantId: actor.tenantId,
        status: { not: 'CANCELLED' },
      },
      include: { planRef: true, nextPlanRef: true },
    });

    if (!sub) {
      throw new SubscriptionNotFoundException();
    }

    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true },
      include: { planRef: true, nextPlanRef: true },
    });

    return this.mapToDto(updated);
  }

  async cancelUndo(actor: ServiceActor): Promise<SubscriptionDto> {
    if (!actor.tenantId) {
      throw new ForbiddenException();
    }

    const sub = await this.prisma.subscription.findFirst({
      where: {
        tenantId: actor.tenantId,
        status: { not: 'CANCELLED' },
      },
      include: { planRef: true, nextPlanRef: true },
    });

    if (!sub) {
      throw new SubscriptionNotFoundException();
    }

    if (!sub.cancelAtPeriodEnd) {
      throw new NoPendingCancellationException();
    }

    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: false },
      include: { planRef: true, nextPlanRef: true },
    });

    return this.mapToDto(updated);
  }

  async resubscribe(
    actor: ServiceActor,
    planCode: string,
  ): Promise<SubscriptionDto> {
    if (!actor.tenantId) {
      throw new ForbiddenException();
    }

    // Must NOT have an active or non-cancelled subscription
    const activeSub = await this.prisma.subscription.findFirst({
      where: {
        tenantId: actor.tenantId,
        status: { not: 'CANCELLED' },
      },
    });

    if (activeSub) {
      throw new InvalidSubscriptionTransitionException();
    }

    const targetCode = planCode.toUpperCase() as PlanCode;
    const plan = await this.prisma.plan.findUnique({
      where: { code: targetCode },
    });
    if (!plan || !plan.isActive) {
      throw new PlanNotFoundException();
    }

    const lastCancelled = await this.prisma.subscription.findFirst({
      where: {
        tenantId: actor.tenantId,
        status: 'CANCELLED',
      },
      orderBy: { createdAt: 'desc' },
    });

    const previousPlan = (lastCancelled?.plan.toLowerCase() ?? 'pro') as WirePlan;
    const now = this.clock.now();

    const newSub = await this.prisma.subscription.create({
      data: {
        tenantId: actor.tenantId,
        plan: targetCode,
        status: 'ACTIVE',
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
      },
      include: { planRef: true, nextPlanRef: true },
    });

    await this.events.publish(actor.tenantId, BILLING_EVENTS.planChanged, {
      plan: targetCode.toLowerCase() as WirePlan,
      features: plan.features as Record<string, boolean>,
      previousPlan,
      effectiveAt: now.toISOString(),
    });

    await this.events.publish(
      actor.tenantId,
      BILLING_EVENTS.subscriptionReactivated,
      {
        plan: targetCode.toLowerCase() as WirePlan,
      },
    );

    return this.mapToDto(newSub);
  }

  async adminListSubscriptions(
    actor: ServiceActor,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: SubscriptionDto[]; total: number }> {
    if (actor.role !== 'platform_admin') {
      throw new ForbiddenException();
    }

    const skip = (Math.max(page, 1) - 1) * pageSize;
    const [total, items] = await Promise.all([
      this.prisma.subscription.count(),
      this.prisma.subscription.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { planRef: true, nextPlanRef: true },
      }),
    ]);

    return {
      items: items.map((sub) => this.mapToDto(sub)),
      total,
    };
  }

  async adminExtendTrial(
    actor: ServiceActor,
    targetTenantId: string,
    newTrialEndsAt: Date | string,
  ): Promise<SubscriptionDto> {
    if (actor.role !== 'platform_admin') {
      throw new ForbiddenException();
    }

    const sub = await this.prisma.subscription.findFirst({
      where: {
        tenantId: targetTenantId,
        status: { not: 'CANCELLED' },
      },
      include: { planRef: true, nextPlanRef: true },
    });

    if (!sub) {
      throw new SubscriptionNotFoundException();
    }

    if (sub.status !== 'TRIAL') {
      throw new InvalidSubscriptionTransitionException();
    }

    const trialDate =
      typeof newTrialEndsAt === 'string'
        ? new Date(newTrialEndsAt)
        : newTrialEndsAt;

    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { trialEndsAt: trialDate },
      include: { planRef: true, nextPlanRef: true },
    });

    return this.mapToDto(updated);
  }

  async expireTrials(): Promise<number> {
    const now = this.clock.now();
    const expiredTrials = await this.prisma.subscription.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: { lte: now },
      },
    });

    for (const sub of expiredTrials) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE' },
      });
    }

    return expiredTrials.length;
  }

  private mapToDto(sub: {
    id: string;
    tenantId: string;
    plan: PlanCode;
    status: SubscriptionStatus;
    trialEndsAt: Date | null;
    nextPlan: PlanCode | null;
    cancelAtPeriodEnd: boolean;
    endedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    planRef: { features: unknown };
  }): SubscriptionDto {
    return {
      id: sub.id,
      tenantId: sub.tenantId,
      plan: sub.plan.toLowerCase() as WirePlan,
      status: sub.status.toLowerCase(),
      trialEndsAt: sub.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
      nextPlan: sub.nextPlan ? (sub.nextPlan.toLowerCase() as WirePlan) : null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      features: (sub.planRef?.features as Record<string, boolean>) ?? {},
      endedAt: sub.endedAt ? sub.endedAt.toISOString() : null,
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
    };
  }
}
