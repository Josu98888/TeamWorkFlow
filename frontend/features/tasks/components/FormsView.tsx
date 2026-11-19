'use client';

import Link from 'next/link';
import { Badge } from '@/shared/components/Badge';
import { ButtonLink } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime } from '@/shared/lib/format';
import { tasksApi } from '../api';

export const FORMS_PATH = '/tareas/formularios';

/** Forms of the tenant (owner/admin): entry to the builder. */
export function FormsView() {
  const forms = useResource(tasksApi.listForms);

  const header = (
    <PageHeader
      title="Formularios de tareas"
      description="Diseñá los formularios que completan los empleados y publicá versiones."
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
    <>
      {header}
      {forms.data.items.length === 0 ? (
        <EmptyState title="Todavía no hay formularios" description="Creá el primero para poder asignar tareas." />
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
    </>
  );
}
