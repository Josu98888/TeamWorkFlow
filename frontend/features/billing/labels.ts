import type { Tone } from '@/shared/components/Badge';
import type { InvoiceStatus, PlanCode, SubscriptionStatus } from './types';

export const PLAN_LABELS = { basic: 'Básico', pro: 'Pro' } as const satisfies Record<PlanCode, string>;

export const SUBSCRIPTION_LABELS = {
  trial: 'Período de prueba',
  active: 'Activa',
  past_due: 'Pago vencido',
  suspended: 'Suspendida',
  cancelled: 'Cancelada',
} as const satisfies Record<SubscriptionStatus, string>;

export const SUBSCRIPTION_TONES = {
  trial: 'info',
  active: 'success',
  past_due: 'warning',
  suspended: 'danger',
  cancelled: 'neutral',
} as const satisfies Record<SubscriptionStatus, Tone>;

export const INVOICE_LABELS = { issued: 'Pendiente de pago', paid: 'Pagada', void: 'Anulada' } as const satisfies Record<InvoiceStatus, string>;

export const INVOICE_TONES = { issued: 'warning', paid: 'success', void: 'neutral' } as const satisfies Record<InvoiceStatus, Tone>;

/** Spanish names of the plan feature flags (`Plan.features`). */
export const FEATURE_LABELS: Record<string, string> = {
  tasks: 'Tareas y formularios',
  alerts: 'Alertas',
  tower: 'Torre de Control',
};

export const featureLabel = (key: string) => FEATURE_LABELS[key] ?? key;

/** Banner shown on the billing screen for states where the backend restricts the tenant. */
export const STATUS_NOTICES: Partial<Record<SubscriptionStatus, { tone: Tone; text: string }>> = {
  past_due: { tone: 'warning', text: 'Tenés facturas vencidas. Pagalas antes de que la cuenta se suspenda.' },
  suspended: {
    tone: 'danger',
    text: 'La cuenta de tu empresa está suspendida por falta de pago. Solo podés usar Facturación hasta regularizarla.',
  },
  cancelled: {
    tone: 'neutral',
    text: 'La suscripción está cancelada. Podés volver a suscribirte eligiendo un plan; tus datos se conservan por un tiempo limitado.',
  },
};
