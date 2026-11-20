'use client';

import { useState } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { formatDateTime } from '@/shared/lib/format';
import { tasksApi } from '../api';
import { taskErrorMessage } from '../errors';
import { AnswerTaskModal } from './AnswerTaskModal';
import type { Task } from '../types';

/** "Mis tareas" of the employee: pending tasks assigned to them and the ones they can claim. */
export function MyTasksSection() {
  const tasks = useResource(tasksApi.listMyTasks);
  const [answering, setAnswering] = useState<Task | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const claim = useAction();

  const claimTask = async (task: Task) => {
    setNotice(null);
    const result = await claim.run(async () => {
      try {
        return await tasksApi.claimTask(task.id);
      } catch (cause) {
        throw new Error(taskErrorMessage(cause, 'No se pudo reclamar la tarea.'));
      }
    });
    // A failed claim (taken by someone else, no shift) may have changed the list: refresh either way.
    tasks.reload();
    if (result) setNotice('Tarea reclamada. Ya podés responderla.');
  };

  return (
    <Card flush glow="none">
      <div className="px-5 pt-5">
        <SectionLabel>Mis tareas</SectionLabel>
      </div>
      {tasks.error ? (
        <div className="p-5">
          <ErrorState message="No pudimos cargar tus tareas." onRetry={tasks.reload} />
        </div>
      ) : !tasks.data ? (
        <div className="p-5">
          <LoadingState rows={1} />
        </div>
      ) : tasks.data.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState title="No tenés tareas pendientes" description="Las tareas asignadas o disponibles en tu puesto aparecen acá." />
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {tasks.data.map((task) => {
            const mine = task.employeeId !== null;
            return (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-title">{task.title}</p>
                  <p className="text-xs text-muted">Vence {formatDateTime(task.deadline)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={mine ? 'info' : 'warning'}>{mine ? 'Asignada a vos' : 'Disponible'}</Badge>
                  {mine ? (
                    <Button variant="primary" onClick={() => setAnswering(task)}>
                      Responder
                    </Button>
                  ) : (
                    <Button onClick={() => void claimTask(task)} disabled={claim.pending}>
                      Reclamar
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {claim.error && (
        <p role="alert" className="mx-5 mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {claim.error}
        </p>
      )}
      {notice && (
        <p role="status" className="mx-5 mb-4 text-xs font-semibold text-title">
          {notice}
        </p>
      )}
      {answering && (
        <AnswerTaskModal
          task={answering}
          onClose={() => setAnswering(null)}
          onDone={() => {
            setAnswering(null);
            setNotice('Respuesta enviada. La tarea quedó completada.');
            tasks.reload();
          }}
        />
      )}
    </Card>
  );
}
