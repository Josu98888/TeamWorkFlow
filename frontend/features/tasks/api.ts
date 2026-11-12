import { tasksMockApi } from './mock';
import type { ListTasksQuery, Task, TaskReport } from './types';

export type TasksApi = {
  listTasks: (query?: ListTasksQuery) => Promise<Task[]>;
  getTaskReport: () => Promise<TaskReport>;
};

// TODO(tasks): the `tasks` module has no HTTP controllers yet. When it does, add `http.ts` and
// switch on `USE_MOCKS` like `organization` and `telemetry` do. Until then it is always mocked.
export const tasksApi: TasksApi = tasksMockApi;
