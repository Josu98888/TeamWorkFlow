import {
  DEFAULT_LOCALE,
  NOTIFICATION_TEMPLATES,
  renderNotificationTemplate,
  resolveLocale,
} from './template-registry';

describe('TemplateRegistry', () => {
  it('resolves Spanish as default locale and falls back from unsupported locales', () => {
    expect(resolveLocale()).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('es-AR')).toBe('es');
    expect(resolveLocale('fr-FR')).toBe(DEFAULT_LOCALE);
  });

  it('renders all 7 domain and billing templates with safe interpolation', () => {
    const samples: Record<string, Record<string, unknown>> = {
      [NOTIFICATION_TEMPLATES.alertOpened]: {
        siteName: 'Planta Norte',
        alertType: 'Ausencia',
        employeeName: 'Juan Pérez',
      },
      [NOTIFICATION_TEMPLATES.taskAssigned]: {
        title: 'Control de extintores',
        deadline: '2026-11-15T18:00:00Z',
      },
      [NOTIFICATION_TEMPLATES.billingInvoiceIssued]: {
        invoiceId: 'inv-1',
        period: '2026-11',
        total: '12100.00',
        dueDate: '2026-11-25T00:00:00Z',
      },
      [NOTIFICATION_TEMPLATES.billingDueSoon]: {
        invoiceId: 'inv-1',
        dueDate: '2026-11-25T00:00:00Z',
      },
      [NOTIFICATION_TEMPLATES.billingOverdueNotice]: {
        invoiceId: 'inv-1',
        delayDay: 4,
      },
      [NOTIFICATION_TEMPLATES.billingSuspended]: {
        invoiceId: 'inv-1',
      },
      [NOTIFICATION_TEMPLATES.billingDataDeletionWarning]: {
        deletionDate: '2027-02-15T00:00:00Z',
      },
    };

    for (const [code, data] of Object.entries(samples)) {
      const rendered = renderNotificationTemplate(code, data, 'en-US');
      expect(rendered).not.toBeNull();
      expect(rendered?.templateCode).toBe(code);
      expect(rendered?.locale).toBe('es');
      expect(rendered?.title.length).toBeGreaterThan(0);
      expect(rendered?.body.length).toBeGreaterThan(0);
      expect(rendered?.body).not.toContain('{{');
    }
  });

  it('uses safe fallbacks when placeholder fields are omitted', () => {
    const alert = renderNotificationTemplate(
      NOTIFICATION_TEMPLATES.alertOpened,
      { siteId: 'site-1', type: 'OUT_OF_GEOFENCE' },
    );
    expect(alert?.title).toBe('Nueva alerta en site-1');
    expect(alert?.body).toContain('OUT_OF_GEOFENCE');
  });

  it('returns null without throwing on unknown templateCode', () => {
    expect(
      renderNotificationTemplate('unknown_custom_template', {}),
    ).toBeNull();
  });
});
