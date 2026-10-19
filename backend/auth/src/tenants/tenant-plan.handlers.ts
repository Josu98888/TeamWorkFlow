import { Injectable, OnModuleInit } from '@nestjs/common';
import { fromWirePlan } from '../common/wire';
import { CONSUMED_SUBJECTS } from '../events/auth.events';
import type { ConsumedSubject } from '../events/auth.events';
import {
  ConsumedEventProcessor,
  PoisonEventError,
} from '../events/consumed-event.processor';
import type {
  ConsumedEventContext,
  PostCommitEffect,
} from '../events/consumed-event.processor';
import type { Plan } from '../generated/prisma/enums';

type PlanEvent = 'subscription_created' | 'plan_changed';

interface PlanUpdate {
  plan: Plan;
  features: Record<string, boolean>;
  // Instant this plan is valid from: `effectiveAt` for `plan_changed`,
  // `occurredAt` for `subscription_created`.
  at: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Billing always sends the full `features` (billing AGENTS § Plan and
// features), so a missing or malformed one is a producer bug: poison.
function parsePlanUpdate(
  event: PlanEvent,
  { payload, occurredAt }: ConsumedEventContext,
): PlanUpdate {
  const { plan, features, effectiveAt } = payload;
  if (plan !== 'basic' && plan !== 'pro') throw new PoisonEventError();
  if (
    !isRecord(features) ||
    !Object.values(features).every((value) => typeof value === 'boolean')
  ) {
    throw new PoisonEventError();
  }

  let at = occurredAt;
  if (event === 'plan_changed') {
    at = new Date(typeof effectiveAt === 'string' ? effectiveAt : NaN);
    if (Number.isNaN(at.getTime())) throw new PoisonEventError();
  }
  return {
    plan: fromWirePlan(plan),
    features: features as Record<string, boolean>,
    at,
  };
}

// Consumers of `subscription_created` and `plan_changed` (AGENTS § Plan and
// features). `auth` stores what billing sends and never decides what a plan
// includes. Dedupe, tenant check and the transaction come from
// `ConsumedEventProcessor`.
@Injectable()
export class TenantPlanHandlers implements OnModuleInit {
  constructor(private readonly processor: ConsumedEventProcessor) {}

  onModuleInit() {
    const handlers: [ConsumedSubject, PlanEvent][] = [
      [CONSUMED_SUBJECTS.subscriptionCreated, 'subscription_created'],
      [CONSUMED_SUBJECTS.planChanged, 'plan_changed'],
    ];
    for (const [filter, event] of handlers) {
      this.processor.register({
        filter,
        handle: (context) => this.apply(event, context),
      });
    }
  }

  async apply(
    event: PlanEvent,
    context: ConsumedEventContext,
  ): Promise<PostCommitEffect[]> {
    const { plan, features, at } = parsePlanUpdate(event, context);

    // One conditional write decides everything, so two concurrent events cannot
    // both pass a stale check. It matches nothing (a no-op) for an unknown or
    // `deleted` tenant, and for an event older than the stored plan. A
    // `cancelled` tenant is updated on purpose: a resubscription sends its
    // `plan_changed` before `subscription_reactivated`.
    await context.tx.tenant.updateMany({
      where: {
        id: context.tenantId,
        status: { not: 'DELETED' },
        OR: [{ planUpdatedAt: null }, { planUpdatedAt: { lte: at } }],
      },
      data: { plan, features, planUpdatedAt: at },
    });
    return [];
  }
}
