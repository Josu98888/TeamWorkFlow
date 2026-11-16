import { TASK_STATUSES, type Task, type TaskReport, type TaskStatus } from './types';

/** Builds the report from a task list (shared by the mock and the HTTP implementation). */
export function buildTaskReport(tasks: Task[]): TaskReport {
  const byStatus = Object.fromEntries(
    TASK_STATUSES.map((status) => [status, tasks.filter((task) => task.status === status).length]),
  ) as Record<TaskStatus, number>;
  const closed = byStatus.COMPLETED + byStatus.EXPIRED;

  const siteIds = [...new Set(tasks.map((task) => task.siteId))];
  return {
    total: tasks.length,
    byStatus,
    complianceRate: closed === 0 ? 0 : byStatus.COMPLETED / closed,
    bySite: siteIds.map((siteId) => {
      const siteTasks = tasks.filter((task) => task.siteId === siteId);
      return {
        siteId,
        total: siteTasks.length,
        completed: siteTasks.filter((task) => task.status === 'COMPLETED').length,
        expired: siteTasks.filter((task) => task.status === 'EXPIRED').length,
        pending: siteTasks.filter((task) => task.status === 'PENDING').length,
      };
    }),
  };
}
