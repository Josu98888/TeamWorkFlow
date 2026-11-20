'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { TextField } from '@/shared/components/Fields';
import { PageHeader } from '@/shared/components/PageHeader';
import { ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime } from '@/shared/lib/format';
import { tasksApi } from '../api';
import { newDraftField, toDraftField, toFormField, validateDraft, type DraftField } from '../form-fields';
import { FORM_FIELD_TYPE_LABELS } from '../labels';
import type { Form, FormVersion } from '../types';
import { FieldEditor } from './FieldEditor';
import { FORMS_PATH } from './FormsView';

/** Builder page: `formId` edits an existing form, no `formId` creates one. */
export function FormBuilder({ formId }: { formId?: string }) {
  if (!formId) return <FormEditor />;
  return <LoadedFormEditor formId={formId} />;
}

function LoadedFormEditor({ formId }: { formId: string }) {
  const form = useResource(tasksApi.getForm, formId);
  const back = { href: FORMS_PATH, label: 'Formularios' };

  if (form.error) {
    return (
      <>
        <PageHeader title="Formulario" back={back} />
        <ErrorState message="No pudimos cargar el formulario." onRetry={form.reload} />
      </>
    );
  }
  if (!form.data) {
    return (
      <>
        <PageHeader title="Formulario" back={back} />
        <LoadingState rows={2} />
      </>
    );
  }
  return <FormEditor key={form.data.id} form={form.data} />;
}

function FormEditor({ form }: { form?: Form }) {
  const router = useRouter();
  const [name, setName] = useState(form?.name ?? '');
  const [fields, setFields] = useState<DraftField[]>(() => (form ? form.draftFields.map(toDraftField) : [newDraftField()]));
  const [versions, setVersions] = useState<FormVersion[]>(form?.versions ?? []);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { run, pending, error, clearError } = useAction();

  const updateField = (uid: string, next: DraftField) => setFields((current) => current.map((item) => (item.uid === uid ? next : item)));
  const removeField = (uid: string) => setFields((current) => current.filter((item) => item.uid !== uid));
  const moveField = (index: number, delta: -1 | 1) =>
    setFields((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  /** Saves the draft (creating the form the first time) and optionally publishes it. */
  const persist = async (publish: boolean) => {
    setNotice(null);
    clearError();
    const problem = validateDraft(name, fields);
    setLocalError(problem);
    if (problem) return;

    const input = { name: name.trim(), fields: fields.map(toFormField) };
    const result = await run(async () => {
      const saved = form ? await tasksApi.updateForm(form.id, input) : await tasksApi.createForm(input);
      const version = publish ? await tasksApi.publishForm(saved.id) : null;
      return { id: saved.id, version };
    });
    if (!result) return;

    const published = result.version;
    if (published) setVersions((current) => [published, ...current]);
    setNotice(published ? `Versión ${published.version} publicada.` : 'Borrador guardado.');
    if (!form) router.replace(`${FORMS_PATH}/${result.id}`);
  };

  const shownError = localError ?? error;

  return (
    <>
      <PageHeader
        title={form ? 'Editar formulario' : 'Nuevo formulario'}
        description="El borrador se edita libremente; al publicar se congela una versión que usan las tareas."
        back={{ href: FORMS_PATH, label: 'Formularios' }}
        actions={
          <>
            <Button onClick={() => void persist(false)} disabled={pending}>
              Guardar borrador
            </Button>
            <Button variant="primary" onClick={() => void persist(true)} disabled={pending}>
              {pending ? 'Guardando...' : 'Publicar versión'}
            </Button>
          </>
        }
      />

      {shownError && (
        <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {shownError}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-semibold text-title">
          {notice}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section aria-label="Campos del formulario" className="space-y-4 lg:col-span-2">
          <Card glow="none">
            <TextField label="Nombre del formulario" value={name} onChange={setName} maxLength={120} required />
          </Card>

          <ul className="space-y-3">
            {fields.map((field, index) => (
              <FieldEditor
                key={field.uid}
                field={field}
                index={index}
                count={fields.length}
                onChange={(next) => updateField(field.uid, next)}
                onMove={(delta) => moveField(index, delta)}
                onRemove={() => removeField(field.uid)}
              />
            ))}
          </ul>
          <Button onClick={() => setFields((current) => [...current, newDraftField()])}>Agregar campo</Button>
        </section>

        <aside aria-label="Versiones publicadas">
          <Card glow="none">
            <SectionLabel>Versiones publicadas</SectionLabel>
            {versions.length === 0 ? (
              <p className="text-xs text-muted">Todavía no se publicó ninguna versión. Sin una versión publicada no se pueden crear tareas.</p>
            ) : (
              <ul className="space-y-3">
                {versions.map((version) => (
                  <li key={version.id}>
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="success">Versión {version.version}</Badge>
                      <span className="text-xs text-muted">{formatDateTime(version.publishedAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-body">
                      {version.fields.map((field) => `${field.label} (${FORM_FIELD_TYPE_LABELS[field.type]})`).join(', ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
