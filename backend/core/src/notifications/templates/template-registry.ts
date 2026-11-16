import { Logger } from '@nestjs/common';

export const DEFAULT_LOCALE = 'es';

export const NOTIFICATION_TEMPLATES = {
  alertOpened: 'alert_opened',
  taskAssigned: 'task_assigned',
  billingInvoiceIssued: 'billing_invoice_issued',
  billingDueSoon: 'billing_due_soon',
  billingOverdueNotice: 'billing_overdue_notice',
  billingSuspended: 'billing_suspended',
  billingDataDeletionWarning: 'billing_data_deletion_warning',
} as const;

export type NotificationTemplateCode =
  (typeof NOTIFICATION_TEMPLATES)[keyof typeof NOTIFICATION_TEMPLATES];

export interface RenderedTemplate {
  templateCode: string;
  locale: string;
  title: string;
  body: string;
}

type TemplateRenderer = (data: Record<string, unknown>) => {
  title: string;
  body: string;
};

function str(
  data: Record<string, unknown>,
  key: string,
  fallback = '—',
): string {
  const value = data[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

const ES_TEMPLATES: Record<NotificationTemplateCode, TemplateRenderer> = {
  alert_opened: (data) => {
    const siteName = str(data, 'siteName', str(data, 'siteId', 'el sitio'));
    const alertType = str(data, 'alertType', str(data, 'type', 'Alerta operativa'));
    const employeeName = str(data, 'employeeName', '');
    return {
      title: `Nueva alerta en ${siteName}`,
      body: employeeName
        ? `Se registró una alerta (${alertType}) para ${employeeName} en ${siteName}.`
        : `Se registró una alerta (${alertType}) en ${siteName}.`,
    };
  },
  task_assigned: (data) => {
    const taskTitle = str(data, 'title', 'Tarea sin título');
    const deadline = str(data, 'deadline');
    return {
      title: 'Nueva tarea asignada',
      body: `Te asignaron la tarea "${taskTitle}". Vence el ${deadline}.`,
    };
  },
  billing_invoice_issued: (data) => {
    const period = str(data, 'period');
    const total = str(data, 'total');
    const dueDate = str(data, 'dueDate');
    return {
      title: 'Nueva factura emitida',
      body: `Se emitió la factura del período ${period} por $${total} con vencimiento ${dueDate}.`,
    };
  },
  billing_due_soon: (data) => {
    const invoiceId = str(data, 'invoiceId');
    const dueDate = str(data, 'dueDate');
    return {
      title: 'Tu factura vence pronto',
      body: `La factura ${invoiceId} vence el ${dueDate}. Recordá abonar a tiempo para evitar recargos.`,
    };
  },
  billing_overdue_notice: (data) => {
    const invoiceId = str(data, 'invoiceId');
    const delayDay = str(data, 'delayDay', '1');
    return {
      title: 'Factura vencida',
      body: `La factura ${invoiceId} presenta ${delayDay} día(s) de mora. Regularizá el pago para evitar la suspensión del servicio.`,
    };
  },
  billing_suspended: (data) => {
    const invoiceId = str(data, 'invoiceId');
    return {
      title: 'Cuenta suspendida por falta de pago',
      body: `Tu cuenta fue suspendida por falta de pago de la factura ${invoiceId}. Regularizá el pago desde Facturación para reactivar el servicio.`,
    };
  },
  billing_data_deletion_warning: (data) => {
    const deletionDate = str(data, 'deletionDate');
    return {
      title: 'Aviso de eliminación de datos',
      body: `Tu cuenta permanece cancelada. Los datos serán eliminados permanentemente el ${deletionDate}.`,
    };
  },
};

const CATALOG: Record<
  string,
  Partial<Record<NotificationTemplateCode, TemplateRenderer>>
> = {
  [DEFAULT_LOCALE]: ES_TEMPLATES,
};

const logger = new Logger('TemplateRegistry');

export function resolveLocale(requested?: string): string {
  if (!requested) {
    return DEFAULT_LOCALE;
  }
  const normalized = requested.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_LOCALE;
  }
  if (CATALOG[normalized]) {
    return normalized;
  }
  const base = normalized.split('-')[0];
  if (base && CATALOG[base]) {
    return base;
  }
  return DEFAULT_LOCALE;
}

export function renderNotificationTemplate(
  templateCode: string,
  data: Record<string, unknown> = {},
  requestedLocale?: string,
): RenderedTemplate | null {
  const locale = resolveLocale(requestedLocale);
  const localized = CATALOG[locale]?.[templateCode as NotificationTemplateCode];
  const fallback = CATALOG[DEFAULT_LOCALE]?.[
    templateCode as NotificationTemplateCode
  ];
  const renderer = localized ?? fallback;
  const resolvedLocale = localized ? locale : DEFAULT_LOCALE;

  if (!renderer) {
    logger.warn(`Unknown notification template code: ${templateCode}`);
    return null;
  }

  const { title, body } = renderer(data);
  return {
    templateCode,
    locale: resolvedLocale,
    title,
    body,
  };
}
