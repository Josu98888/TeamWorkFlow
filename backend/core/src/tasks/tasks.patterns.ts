// Operation names of the tasks module (AGENTS § NATS Contract).
// In `core` they are in-process facade calls; tasks answers no NATS requests.
export const TASKS_PATTERNS = {
  formCreate: 'tasks.form.create',
  formUpdate: 'tasks.form.update',
  formPublish: 'tasks.form.publish',
  formGet: 'tasks.form.get',
  formList: 'tasks.form.list',
  taskTemplateCreate: 'tasks.task-template.create',
  taskTemplateUpdate: 'tasks.task-template.update',
  taskTemplateList: 'tasks.task-template.list',
  taskCreate: 'tasks.task.create',
  taskGet: 'tasks.task.get',
  taskList: 'tasks.task.list',
  taskClaim: 'tasks.task.claim',
  taskAnswer: 'tasks.task.answer',
  taskReview: 'tasks.task.review',
  mediaRequestUpload: 'tasks.media.request-upload',
  mediaGetUrl: 'tasks.media.get-url',
} as const;

export type TasksPattern =
  (typeof TASKS_PATTERNS)[keyof typeof TASKS_PATTERNS];

export const TASKS_MODULE = 'tasks';

// Stream owned by tasks (backend STEPS S1.2): captures every emitted subject.
export const TASKS_STREAM = 'TASKS_EVENTS';
export const TASKS_STREAM_SUBJECTS = `t.*.${TASKS_MODULE}.>`;
