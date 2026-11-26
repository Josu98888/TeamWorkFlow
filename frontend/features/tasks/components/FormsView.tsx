'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/shared/components/Badge';
import { ButtonLink } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime } from '@/shared/lib/format';
import { tasksApi } from '../api';
import { FORM_TEMPLATES, TEMPLATE_INDUSTRIES, type TemplateIndustry } from '../form-templates';

export const FORMS_PATH = '/tareas/formularios';

/** Forms of the tenant (owner/admin): entry to the builder and industry templates. */
export function FormsView() {
  const forms = useResource(tasksApi.listForms);
  const [industry, setIndustry] = useState<'Todas' | TemplateIndustry>('Todas');

  const filteredTemplates =
    industry === 'Todas' ? FORM_TEMPLATES : FORM_TEMPLATES.filter((tpl) => tpl.industry === industry);

  const header = (
    <PageHeader
      title="Formularios de tareas"
      description="Diseñá los formularios que completan los empleados, partí de una plantilla por rubro y publicá versiones."
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
              Elegí un modelo operativo preconfigurado para personalizarlo y publicarlo en segundos.
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
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
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
                  <span className="text-xs text-muted">{tpl.fields.length} campos</span>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-title">{tpl.name}</h3>
                <p className="mt-1 text-xs text-muted">{tpl.description}</p>
              </div>
              <div className="pt-1">
                <ButtonLink href={`${FORMS_PATH}/nuevo?template=${tpl.id}`} className="w-full justify-center">
                  Usar plantilla
                </ButtonLink>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="Formularios creados" className="space-y-2">
        <SectionLabel>Formularios de la organización ({forms.data.items.length})</SectionLabel>
        {forms.data.items.length === 0 ? (
          <EmptyState title="Todavía no hay formularios" description="Creá el primero o elegí una plantilla arriba." />
        ) : (
          <Card flush glow="none">
            <ul className="divide-y divide-line">
              {forms.data.items.map((form) => (
                <li key={form.id}>
                  <Link
                    href={`${FORMS_PATH}/${form.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-alt"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-title">{form.name}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {form.draftFields.length} {form.draftFields.length === 1 ? 'campo' : 'campos'} · editado{' '}
                        {formatDateTime(form.updatedAt)}
                      </p>
                    </div>
                    <Badge tone="info">Editar</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}