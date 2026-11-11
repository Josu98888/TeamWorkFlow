'use client';

import { useState } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { SelectField } from '@/shared/components/Fields';
import { useAction } from '@/shared/hooks/useAction';
import { formatDate } from '@/shared/lib/format';
import { billingApi } from '../api';
import { PLAN_LABELS, STATUS_NOTICES, SUBSCRIPTION_LABELS, SUBSCRIPTION_TONES } from '../labels';
import { PLAN_CODES, type PlanCode, type Subscription } from '../types';

/** Current subscription with the owner/admin actions: change plan, cancel, undo cancel, resubscribe. */
export function SubscriptionPanel({ subscription, onChanged }: { subscription: Subscription; onChanged: () => void }) {
  const [target, setTarget] = useState<PlanCode>(subscription.plan === 'pro' ? 'basic' : 'pro');
  const action = useAction();
  const notice = STATUS_NOTICES[subscription.status];
  const cancelled = subscription.status === 'cancelled';

  const run = async (call: () => Promise<unknown>) => {
    const result = await action.run(call);
    if (result !== undefined) onChanged();
  };

  return (
    <Card className="mb-4">
      <SectionLabel>Suscripción</SectionLabel>
      {notice && (
        <p
          role="status"
          className={`mb-3 rounded-lg border px-3 py-2 text-xs ${notice.tone === 'danger' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-line bg-alt text-body'}`}
        >
          {notice.text}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-bold text-title">Plan {PLAN_LABELS[subscription.plan] ?? subscription.plan}</span>
        <Badge tone={SUBSCRIPTION_TONES[subscription.status] ?? 'neutral'}>{SUBSCRIPTION_LABELS[subscription.status] ?? subscription.status}</Badge>
        {subscription.cancelAtPeriodEnd && <Badge tone="warning">Se cancela a fin de mes</Badge>}
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-muted">
        {subscription.status === 'trial' && subscription.trialEndsAt && <li>La prueba gratuita termina el {formatDate(subscription.trialEndsAt)}.</li>}
        {subscription.nextPlan && <li>Cambio programado al plan {PLAN_LABELS[subscription.nextPlan]} el próximo mes.</li>}
        {subscription.endedAt && <li>Finalizó el {formatDate(subscription.endedAt)}.</li>}
      </ul>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-52">
          <SelectField
            label={cancelled ? 'Plan para volver a suscribirte' : 'Cambiar a'}
            value={target}
            onChange={(value) => setTarget(value as PlanCode)}
            options={PLAN_CODES.filter((code) => cancelled || code !== subscription.plan).map((code) => ({ value: code, label: PLAN_LABELS[code] }))}
          />
        </div>
        {cancelled ? (
          <Button variant="primary" disabled={action.pending} onClick={() => void run(() => billingApi.resubscribe(target))}>
            Volver a suscribirme
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              disabled={action.pending || subscription.status === 'suspended'}
              onClick={() => void run(() => billingApi.changePlan(target))}
            >
              Cambiar plan
            </Button>
            {subscription.cancelAtPeriodEnd ? (
              <Button disabled={action.pending} onClick={() => void run(billingApi.undoCancel)}>
                Deshacer cancelación
              </Button>
            ) : (
              <Button
                disabled={action.pending}
                onClick={() => {
                  if (window.confirm('La suscripción se cancela a fin de mes. ¿Querés continuar?')) void run(billingApi.cancelSubscription);
                }}
              >
                Cancelar suscripción
              </Button>
            )}
          </>
        )}
      </div>
      {!cancelled && subscription.plan === 'pro' && (
        <p className="mt-2 text-[11px] text-muted">Pasar a Básico se aplica al inicio del próximo período; hasta entonces conservás Pro.</p>
      )}
      {action.error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {action.error}
        </p>
      )}
    </Card>
  );
}
