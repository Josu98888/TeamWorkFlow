import { USE_MOCKS } from '@/shared/lib/config';
import { tasksHttpApi } from './http';
import { tasksMockApi } from './mock';
import type { ListTasksQuery, Task, TaskReport } from './types';

export type TasksApi = {
  listTasks: (query?: ListTasksQuery) => Promise<Task[]>;
  getTaskReport: () => Promise<TaskReport>;
};

// The only mock/real switch of this domain (see `shared/lib/config.ts`).
export const tasksApi: TasksApi = USE_MOCKS ? tasksMockApi : tasksHttpApi;
