// Shape documented in backend/core/src/tasks/AGENTS.md (§ Data Model). The `tasks` module is NOT built
// yet, so there is no HTTP contract: these types follow the design doc and may change.
// TODO(tasks): re-check against the real response DTOs once `tasks` exposes its controllers.

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

export type ListTasksQuery = {
  status?: TaskStatus;
  employeeId?: string;
  siteId?: string;
};

/** Report numbers are mock-only: no reporting endpoint is designed yet. */
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
