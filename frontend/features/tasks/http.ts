import { apiFetch } from '@/shared/lib/http';
import type { TasksApi } from './api';
import { buildTaskReport } from './report';
import type { Form, FormInput, FormVersion, FormsPage, ListTasksQuery, Task, TasksPage } from './types';

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
};
