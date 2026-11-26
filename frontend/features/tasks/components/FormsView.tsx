'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/shared/components/Badge';
import { Button, ButtonLink } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { Modal } from '@/shared/components/Modal';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime } from '@/shared/lib/format';
import { tasksApi } from '../api';
import { FORM_TEMPLATES, TEMPLATE_INDUSTRIES, type FormTemplate, type TemplateIndustry } from '../form-templates';
import { FORM_FIELD_TYPE_LABELS } from '../labels';

export const FORMS_PATH = '/tareas/formularios';

async function loadFormsWithStatus() {
  const { items } = await tasksApi.listForms();
  return Promise.all(
    items.map(async (form) => {
      try {
        const detail = await tasksApi.getForm(form.id);
        return { ...form, latestVersion: detail.versions?.[0] ?? null };
      } catch {
        return { ...form, latestVersion: null };
      }
    }),
  );
}

/** Forms of the tenant (owner/admin): entry to the builder and industry templates. */
export function FormsView() {
  const forms = useResource(loadFormsWithStatus);
  const [industry, setIndustry] = useState<'Todas' | TemplateIndustry>('Todas');
  const [previewTemplate, setPreviewTemplate] = useState<FormTemplate | null>(null);

  const filteredTemplates =
    industry === 'Todas' ? FORM_TEMPLATES : FORM_TEMPLATES.filter((tpl) => tpl.industry === industry);

  const header = (
    <PageHeader
      title="Formularios de tareas"
      description="Plantillas operativas por rubro y formularios publicados de la organización."
      back={{ href: '/tareas', label: 'Tareas y Reportes' }}
      actions={
        <ButtonLink href={`${FORMS_PATH}/nuevo`} variant="primary">
          Nuevo formulario
        </ButtonLink>
      }
    />
  );

  if (forms.error) {
    return (
      <>
        {header}
        <ErrorState message="No pudimos cargar los formularios." onRetry={forms.reload} />
      </>
    );
  }
  if (!forms.data) {
    return (
      <>
        {header}
        <LoadingState rows={2} />
      </>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <section aria-label="Plantillas por rubro" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <SectionLabel>Plantillas por rubro</SectionLabel>
            <p className="text-xs text-muted">
              Modelos operativos listos para personalizar y publicar.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar plantillas por rubro">
            {(['Todas', ...TEMPLATE_INDUSTRIES] as const).map((item) => {
              const active = industry === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setIndustry(item)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'border-title bg-title text-page'
                      : 'border-line bg-surface text-body hover:bg-alt'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((tpl) => (
            <Card key={tpl.id} glow="none" className="flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="neutral">{tpl.industry}</Badge>
                  <span className="font-mono text-xs tabular-nums text-muted">{tpl.fields.length} campos</span>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-title">{tpl.name}</h3>
                <p className="mt-1 text-xs text-muted">{tpl.description}</p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button type="button" onClick={() => setPreviewTemplate(tpl)} className="flex-1 justify-center">
                  Ver campos
                </Button>
                <ButtonLink href={`${FORMS_PATH}/nuevo?template=${tpl.id}`} variant="primary" className="flex-1 justify-center">
                  Usar plantilla
                </ButtonLink>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="Formularios creados" className="space-y-2">
        <SectionLabel>Formularios de la organización ({forms.data.length})</SectionLabel>
        {forms.data.length === 0 ? (
          <EmptyState title="Todavía no hay formularios" description="Creá el primero o elegí una plantilla arriba." />
        ) : (
          <Card flush glow="none">
            <ul className="divide-y divide-line">
              {forms.data.map((form) => {
                const uniqueTypes = Array.from(new Set(form.draftFields.map((f) => f.type)));
                return (
                  <li key={form.id}>
                    <Link
                      href={`${FORMS_PATH}/${form.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-alt"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-title">{form.name}</p>
                          {form.latestVersion ? (
                            <Badge tone="success">Publicada v{form.latestVersion.version}</Badge>
                          ) : (
                            <Badge tone="warning">Borrador sin publicar</Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <span className="tabular-nums">
                            {form.draftFields.length} {form.draftFields.length === 1 ? 'campo' : 'campos'}
                          </span>
                          <span>·</span>
                          <span>editado {formatDateTime(form.updatedAt)}</span>
                          {uniqueTypes.length > 0 && (
                            <>
                              <span>·</span>
                              <span className="inline-flex flex-wrap gap-1">
                                {uniqueTypes.map((type) => (
                                  <span
                                    key={type}
                                    className="rounded border border-line bg-alt/70 px-1.5 py-0.2 text-[11px] font-medium text-body"
                                  >
                                    {FORM_FIELD_TYPE_LABELS[type]}
                                  </span>
                                ))}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-title">Abrir editor →</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      {previewTemplate && (
        <Modal title={`${previewTemplate.industry} · ${previewTemplate.name}`} onClose={() => setPreviewTemplate(null)}>
          <div className="space-y-4">
            <p className="text-xs text-muted">{previewTemplate.description}</p>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {previewTemplate.fields.map((field, idx) => (
                <li key={field.key} className="space-y-1 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-title">
                      {idx + 1}. {field.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge tone="info">{FORM_FIELD_TYPE_LABELS[field.type]}</Badge>
                      {field.required && <Badge tone="warning">Obligatorio</Badge>}
                    </div>
                  </div>
                  {field.options && field.options.length > 0 && (
                    <p className="text-xs text-muted">Opciones: {field.options.join(' · ')}</p>
                  )}
                  {(field.min !== undefined || field.max !== undefined) && (
                    <p className="text-xs text-muted">
                      Rango permitido: {field.min ?? '—'} a {field.max ?? '—'}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setPreviewTemplate(null)}>
                Cerrar
              </Button>
              <ButtonLink href={`${FORMS_PATH}/nuevo?template=${previewTemplate.id}`} variant="primary">
                Usar esta plantilla
              </ButtonLink>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}