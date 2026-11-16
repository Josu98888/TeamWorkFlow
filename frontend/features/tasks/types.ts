// Mirrors `GET /api/v1/tasks` of core (`backend/core/src/tasks`, DTOs in `http/dto/tasks.dto.ts`).
// Enum values are the Prisma enums (uppercase). The backend also embeds `formVersion` and `answer` in
// each item; the Tasks screen does not use them, so they are not typed here.

export const TASK_KINDS = ['SINGLE', 'PER_SHIFT'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ['PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Task = {
  id: string;
  tenantId: string;
  kind: TaskKind;
  status: TaskStatus;
  title: string;
  /** ISO instant; the expiration job moves PENDING tasks past it to EXPIRED. */
  deadline: string;
  /** Null until someone claims a site/post task. */
  employeeId: string | null;
  claimedAt: string | null;
  siteId: string;
  postId: string;
  shiftId: string | null;
  createdAt: string;
};

/** Lists return `{ items, total }` (query: `page`, `pageSize` up to 100). */
export type TasksPage = {
  items: Task[];
  total: number;
};

export type ListTasksQuery = {
  status?: TaskStatus;
  employeeId?: string;
  siteId?: string;
};

/** Computed client-side from the task list: core has no reporting endpoint. */
export type TaskReportBySite = {
  siteId: string;
  total: number;
  completed: number;
  expired: number;
  pending: number;
};

export type TaskReport = {
  total: number;
  byStatus: Record<TaskStatus, number>;
  /** completed / (completed + expired), 0 when nothing closed yet. */
  complianceRate: number;
  bySite: TaskReportBySite[];
};
