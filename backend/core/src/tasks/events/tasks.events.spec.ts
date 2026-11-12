import {
  TASKS_EVENTS,
  tasksEventSubject,
} from './tasks.events';

describe('tasks.events', () => {
  it('builds valid event subjects with tenant prefix and tasks module', () => {
    expect(tasksEventSubject('tenant-123', TASKS_EVENTS.taskAssigned)).toBe(
      't.tenant-123.tasks.task_assigned',
    );
    expect(tasksEventSubject('tenant-456', TASKS_EVENTS.taskCompleted)).toBe(
      't.tenant-456.tasks.task_completed',
    );
    expect(tasksEventSubject('tenant-789', TASKS_EVENTS.taskExpired)).toBe(
      't.tenant-789.tasks.task_expired',
    );
  });

  it('rejects invalid tenant tokens with dots, spaces, or wildcards', () => {
    expect(() =>
      tasksEventSubject('tenant.invalid', TASKS_EVENTS.taskAssigned),
    ).toThrow('Invalid tenant id for an event subject');
    expect(() =>
      tasksEventSubject('tenant with spaces', TASKS_EVENTS.taskCompleted),
    ).toThrow('Invalid tenant id for an event subject');
    expect(() =>
      tasksEventSubject('tenant*', TASKS_EVENTS.taskExpired),
    ).toThrow('Invalid tenant id for an event subject');
  });
});
