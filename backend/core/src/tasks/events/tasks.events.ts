import { TASKS_MODULE } from '../tasks.patterns';

export const TASKS_EVENTS = {
  taskAssigned: 'task_assigned',
  taskCompleted: 'task_completed',
  taskExpired: 'task_expired',
} as const;

export type TasksEventName =
  (typeof TASKS_EVENTS)[keyof typeof TASKS_EVENTS];

export interface EventMeta {
  eventId: string;
  occurredAt: string;
}

export interface TasksEventPayloads {
  task_assigned: {
    tenantId: string;
    taskId: string;
    employeeId: string | null;
    siteId: string;
    postId: string;
    shiftId: string | null;
    title: string;
    deadline: string;
  };
  task_completed: {
    tenantId: string;
    taskId: string;
    employeeId: string;
    siteId: string;
  };
  task_expired: {
    tenantId: string;
    taskId: string;
    employeeId: string | null;
    siteId: string;
  };
}

export type PublishedTasksEvent<E extends TasksEventName> =
  TasksEventPayloads[E] & EventMeta;

// A tenant id becomes a subject token: it must not contain `.`, `*`, `>` or spaces.
const SUBJECT_TOKEN = /^[A-Za-z0-9_-]+$/;

export function tasksEventSubject(tenantId: string, event: TasksEventName): string {
  if (!SUBJECT_TOKEN.test(tenantId)) {
    throw new Error('Invalid tenant id for an event subject');
  }
  return `t.${tenantId}.${TASKS_MODULE}.${event}`;
}
