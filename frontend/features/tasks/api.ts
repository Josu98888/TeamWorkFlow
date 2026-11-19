import { USE_MOCKS } from '@/shared/lib/config';
import { tasksHttpApi } from './http';
import { tasksMockApi } from './mock';
import type { CreateTaskInput, Form, FormInput, FormVersion, FormsPage, ListTasksQuery, Task, TaskReport } from './types';

export type TasksApi = {
  listTasks: (query?: ListTasksQuery) => Promise<Task[]>;
  getTaskReport: () => Promise<TaskReport>;
  /** Forms of the tenant, newest first; `versions` is only present in `getForm`. */
  listForms: () => Promise<FormsPage>;
  getForm: (formId: string) => Promise<Form>;
  createForm: (input: FormInput) => Promise<Form>;
  updateForm: (formId: string, input: Partial<FormInput>) => Promise<Form>;
  /** Freezes the current draft as a new immutable version. */
  publishForm: (formId: string) => Promise<FormVersion>;
  createTask: (input: CreateTaskInput) => Promise<Task>;
};

// The only mock/real switch of this domain (see `shared/lib/config.ts`).
export const tasksApi: TasksApi = USE_MOCKS ? tasksMockApi : tasksHttpApi;
