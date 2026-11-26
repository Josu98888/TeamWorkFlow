'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { ApiError } from '@/shared/lib/http';
import { formatDateTime } from '@/shared/lib/format';
import { tasksApi } from '../api';
import { FORM_FIELD_TYPE_LABELS, TASK_KIND_LABELS, TASK_STATUS_LABELS, TASK_STATUS_TONES } from '../labels';
import type { FormField, Task } from '../types';

const REVIEW_LABELS: Record<'NONE' | 'APPROVED' | 'OBSERVED', string> = {
  NONE: 'Sin revisar',
  APPROVED: 'Aprobada',
  OBSERVED: 'Con observaciones',
};

const REVIEW_TONES: Record<'NONE' | 'APPROVED' | 'OBSERVED', 'neutral' | 'success' | 'warning'> = {
  NONE: 'neutral',
  APPROVED: 'success',
  OBSERVED: 'warning',
};

function renderAnswerValue(field: FormField, rawValue: unknown, expectedQr?: string | null) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return <span className="italic text-muted">Sin respuesta</span>;
  }

  if (field.type === 'yes_no') {
    const yes = rawValue === true || rawValue === 'true' || rawValue === 'yes';
    return <Badge tone={yes ? 'success' : 'danger'}>{yes ? 'Sí' : 'No'}</Badge>;
  }

  if (field.type === 'checklist' && Array.isArray(rawValue)) {
    if (rawValue.length === 0) return <span className="italic text-muted">Ningún ítem marcado</span>;
    return (
      <ul className="mt-1 space-y-1">
        {rawValue.map((item, idx) => (
          <li key={idx} className="flex items-center gap-1.5 text-xs text-body">
            <span className="text-status-success font-bold">✓</span>
            <span>{String(item)}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (field.type === 'qr') {
    const scanned = String(rawValue);
    const matches = expectedQr ? scanned === expectedQr : true;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded border border-line bg-alt px-2 py-0.5 font-mono text-xs text-title">{scanned}</code>
        {expectedQr && (
          <Badge tone={matches ? 'success' : 'danger'}>
            {matches ? 'Coincide con QR del puesto' : `Esperado: ${expectedQr}`}
          </Badge>
        )}
      </div>
    );
  }

  if (field.type === 'photo') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-alt/70 px-2.5 py-1 font-mono text-xs text-title">
        Evidencia adjunta · ID {String(rawValue).slice(0, 12)}
      </span>
    );
  }

  return <p className="text-xs font-medium text-title">{String(rawValue)}</p>;
}

export function TaskDetailDrawer({
  task,
  siteName,
  employeeName,
  onClose,
  onReviewed,
}: {
  task: Task;
  siteName: string;
  employeeName: string | null;
  onClose: () => void;
  onReviewed?: (updated: Task) => void;
}) {
  const [observing, setObserving] = useState(false);
  const [note, setNote] = useState(task.answer?.reviewNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const fields = task.formVersion?.fields ?? [];
  const answer = task.answer ?? null;

  async function handleReview(result: 'APPROVED' | 'OBSERVED') {
    if (result === 'OBSERVED' && !note.trim()) {
      setError('Escribí el motivo de la observación para el empleado.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await tasksApi.reviewTask(task.id, {
        result,
        note: result === 'OBSERVED' ? note.trim() : undefined,
      });
      setObserving(false);
      onReviewed?.(updated);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo registrar la revisión en este momento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalle de ${task.title}`}
    >
      <div className="flex-1" onClick={onClose} aria-hidden="true" />
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-line bg-card shadow-2xl">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-line bg-alt/60 px-6 py-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TASK_STATUS_TONES[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
              <span className="text-xs text-muted">{TASK_KIND_LABELS[task.kind]}</span>
            </div>
            <h2 className="text-base font-bold text-title">{task.title}</h2>
            {task.formVersion && (
              <p className="text-xs text-muted">
                Formulario: <span className="font-medium text-body">{task.formVersion.name}</span> · v
                {task.formVersion.version}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de detalle"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-sm font-semibold text-muted transition-colors hover:bg-alt hover:text-title cursor-pointer"
          >
            ✕
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Operational Metadata */}
          <section className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Datos operativos</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <div>
                <dt className="text-muted">Sede</dt>
                <dd className="mt-0.5 font-semibold text-title">{siteName}</dd>
              </div>
              <div>
                <dt className="text-muted">Responsable</dt>
                <dd className="mt-0.5 font-semibold text-title">
                  {employeeName ?? <span className="italic font-normal text-muted">Sin reclamar</span>}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Vencimiento</dt>
                <dd className="mt-0.5 tabular-nums font-medium text-body">{formatDateTime(task.deadline)}</dd>
              </div>
              <div>
                <dt className="text-muted">Creada</dt>
                <dd className="mt-0.5 tabular-nums font-medium text-body">{formatDateTime(task.createdAt)}</dd>
              </div>
              {task.claimedAt && (
                <div>
                  <dt className="text-muted">Reclamada</dt>
                  <dd className="mt-0.5 tabular-nums font-medium text-body">{formatDateTime(task.claimedAt)}</dd>
                </div>
              )}
              {task.expectedQr && (
                <div>
                  <dt className="text-muted">QR esperado del puesto</dt>
                  <dd className="mt-0.5">
                    <code className="rounded border border-line bg-alt px-1.5 py-0.5 font-mono text-[11px] text-title">
                      {task.expectedQr}
                    </code>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* Completed Answer & Evidence */}
          {answer ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Evidencia y respuestas enviadas
                </h3>
                <Badge tone={REVIEW_TONES[answer.reviewResult]}>{REVIEW_LABELS[answer.reviewResult]}</Badge>
              </div>

              {answer.reviewNote && (
                <div className="rounded-lg border border-line bg-alt/70 px-3.5 py-2.5 text-xs text-body">
                  <span className="font-semibold text-title">Nota de revisión: </span>
                  {answer.reviewNote}
                </div>
              )}

              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {fields.map((field, index) => (
                  <li key={field.key} className="space-y-1.5 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-title">
                        {index + 1}. {field.label}
                      </p>
                      <span className="text-[11px] text-muted">{FORM_FIELD_TYPE_LABELS[field.type]}</span>
                    </div>
                    <div>{renderAnswerValue(field, answer.answers[field.key], task.expectedQr)}</div>
                  </li>
                ))}
              </ul>

              <p className="text-[11px] tabular-nums text-muted">
                Registrada en dispositivo: {formatDateTime(answer.deviceTime)} · Recibida:{' '}
                {formatDateTime(answer.receivedAt)}
              </p>

              {/* Supervisor Audit Form */}
              {observing && (
                <div className="space-y-2 rounded-xl border border-line bg-surface p-3.5">
                  <label htmlFor="review-note" className="block text-xs font-semibold text-title">
                    Detalle de la observación
                  </label>
                  <textarea
                    id="review-note"
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ej: Falta foto legible del precinto trasero..."
                    className="w-full rounded-lg border border-line bg-card px-3 py-2 text-xs text-body outline-none placeholder:text-muted focus:border-brand-medium"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" onClick={() => setObserving(false)} disabled={saving}>
                      Cancelar
                    </Button>
                    <Button type="button" variant="primary" onClick={() => void handleReview('OBSERVED')} disabled={saving}>
                      {saving ? 'Guardando...' : 'Guardar observación'}
                    </Button>
                  </div>
                </div>
              )}

              {error && <p className="text-xs font-medium text-status-danger">{error}</p>}
            </section>
          ) : (
            <section className="space-y-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Checklist esperado ({fields.length} {fields.length === 1 ? 'campo' : 'campos'})
              </h3>
              {fields.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs text-muted">
                  Esta tarea aún no tiene respuestas cargadas.
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                  {fields.map((field, index) => (
                    <li key={field.key} className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs">
                      <span className="font-medium text-body">
                        {index + 1}. {field.label}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Badge tone="neutral">{FORM_FIELD_TYPE_LABELS[field.type]}</Badge>
                        {field.required && <Badge tone="warning">Oblig.</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-alt/40 px-6 py-3.5">
          {answer && !observing ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => void handleReview('APPROVED')}
                disabled={saving || answer.reviewResult === 'APPROVED'}
              >
                {answer.reviewResult === 'APPROVED' ? 'Aprobada ✓' : 'Aprobar'}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setError(null);
                  setObserving(true);
                }}
                disabled={saving}
              >
                Observar
              </Button>
            </div>
          ) : (
            <span />
          )}

          <Button type="button" onClick={onClose}>
            Cerrar
          </Button>
        </footer>
      </aside>
    </div>
  );
}