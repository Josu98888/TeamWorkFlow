import { apiFetch } from '@/shared/lib/http';
import type { TasksApi } from './api';
import { buildTaskReport } from './report';
import type { AnswerTaskInput, CreateTaskInput, Form, FormInput, FormVersion, FormsPage, ListTasksQuery, MediaUpload, RequestUploadInput, Task, TasksPage } from './types';

/** Backend maximum for `pageSize` (`ListTasksQueryDto`). */
const PAGE_SIZE = 100;
/**
 * Safety cap on the pages fetched to build the list and the report: 10 pages x 100 = 1000 tasks.
 * Core has no reporting endpoint, so both numbers are computed from the listed tasks; beyond the cap the
 * oldest-deadline tasks win (core orders by `deadline` ascending).
 */
const MAX_PAGES = 10;

function qs(query: ListTasksQuery, page: number): string {
  const search = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (query.status) search.set('status', query.status);
  if (query.employeeId) search.set('employeeId', query.employeeId);
  if (query.siteId) search.set('siteId', query.siteId);
  return `?${search.toString()}`;
}

async function listAll(query: ListTasksQuery): Promise<Task[]> {
  const tasks: Task[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await apiFetch<TasksPage>(`/tasks${qs(query, page)}`);
    tasks.push(...result.items);
    if (tasks.length >= result.total || result.items.length < PAGE_SIZE) break;
  }
  return tasks;
}

/** Real implementation against `core` (`GET /api/v1/tasks`). */
export const tasksHttpApi: TasksApi = {
  listTasks: (query = {}) => listAll(query),
  getTaskReport: async () => buildTaskReport(await listAll({})),
  listForms: () => apiFetch<FormsPage>('/forms?page=1&pageSize=100'),
  getForm: (formId) => apiFetch<Form>(`/forms/${formId}`),
  createForm: (input: FormInput) => apiFetch<Form>('/forms', { method: 'POST', body: JSON.stringify(input) }),
  updateForm: (formId, input) => apiFetch<Form>(`/forms/${formId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  publishForm: (formId) => apiFetch<FormVersion>(`/forms/${formId}/publish`, { method: 'POST', body: '{}' }),
  createTask: (input: CreateTaskInput) => apiFetch<Task>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
  listMyTasks: () => listAll({ status: 'PENDING' }),
  claimTask: (taskId) => apiFetch<Task>(`/tasks/${taskId}/claim`, { method: 'POST', body: '{}' }),
  answerTask: (taskId, input: AnswerTaskInput) =>
    apiFetch<Task>(`/tasks/${taskId}/answer`, { method: 'POST', body: JSON.stringify(input) }),
  requestUpload: (input: RequestUploadInput) =>
    apiFetch<MediaUpload>('/media/uploads', { method: 'POST', body: JSON.stringify(input) }),
  uploadFile: async (uploadUrl, file) => {
    // Plain fetch: the presigned URL points at the storage origin (no session cookies or CSRF header).
    // The URL signs the content type, so it must match what was declared in `requestUpload`.
    const response = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!response.ok) throw new Error('No se pudo subir la foto. Revisá tu conexión e intentá de nuevo.');
  },
};
