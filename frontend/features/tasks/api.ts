import { USE_MOCKS } from '@/shared/lib/config';
import { tasksHttpApi } from './http';
import { tasksMockApi } from './mock';
import type {
  AnswerTaskInput,
  CreateTaskInput,
  Form,
  FormInput,
  FormVersion,
  FormsPage,
  ListTasksQuery,
  MediaUpload,
  RequestUploadInput,
  ReviewTaskInput,
  Task,
  TaskReport,
} from './types';

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
  /** Employee: pending tasks assigned to them plus the unclaimed ones (core scopes the list by actor). */
  listMyTasks: () => Promise<Task[]>;
  claimTask: (taskId: string) => Promise<Task>;
  /** Completes the task (claims it first when unclaimed). */
  answerTask: (taskId: string, input: AnswerTaskInput) => Promise<Task>;
  /** Supervisor/Admin: approves or observes a completed task answer. */
  reviewTask: (taskId: string, input: ReviewTaskInput) => Promise<Task>;
  requestUpload: (input: RequestUploadInput) => Promise<MediaUpload>;
  /** PUTs the file bytes to the presigned URL returned by `requestUpload`. */
  uploadFile: (uploadUrl: string, file: File) => Promise<void>;
};

// The only mock/real switch of this domain (see `shared/lib/config.ts`).
export const tasksApi: TasksApi = USE_MOCKS ? tasksMockApi : tasksHttpApi;