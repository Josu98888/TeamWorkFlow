'use client';

import { useState, type FormEvent } from 'react';
import { FormFooter } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { useAction } from '@/shared/hooks/useAction';
import { tasksApi } from '../api';
import { buildAnswers, validateAnswers, type AnswerValues } from '../answers';
import { taskErrorMessage } from '../errors';
import type { Task } from '../types';
import { FieldInput } from './AnswerFields';

/** Form of the task's version for the employee to fill in and submit (`POST /tasks/:id/answer`). */
export function AnswerTaskModal({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: () => void }) {
  const fields = task.formVersion?.fields ?? [];
  const [values, setValues] = useState<AnswerValues>({});
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);
  // One id per opened form: retrying after a network failure is idempotent in core.
  const [clientAnswerId] = useState(() => crypto.randomUUID());
  const { run, pending, error } = useAction();

  const setBusy = (key: string, busy: boolean) =>
    setBusyKeys((current) => {
      const next = new Set(current);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyKeys.size > 0) {
      setLocalError('Esperá a que termine de subirse la foto.');
      return;
    }
    const problem = validateAnswers(fields, values);
    setLocalError(problem);
    if (problem) return;

    const result = await run(async () => {
      try {
        return await tasksApi.answerTask(task.id, {
          clientAnswerId,
          deviceTime: new Date().toISOString(),
          answers: buildAnswers(fields, values),
        });
      } catch (cause) {
        throw new Error(taskErrorMessage(cause, 'No se pudo enviar la respuesta.'));
      }
    });
    if (result) onDone();
  };

  return (
    <Modal title={task.title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {fields.length === 0 && <p className="text-sm text-muted">Esta tarea no tiene campos para completar.</p>}
        {fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
            onBusyChange={(busy) => setBusy(field.key, busy)}
          />
        ))}
        <FormFooter error={localError ?? error} pending={pending || busyKeys.size > 0} submitLabel="Enviar respuesta" onCancel={onClose} />
      </form>
    </Modal>
  );
}
