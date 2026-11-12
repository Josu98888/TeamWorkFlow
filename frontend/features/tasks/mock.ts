import { minutesFromNow, mockResponse } from '@/shared/lib/mock';
import { SITE_COUNT, TENANT_ID, employeeId, mockId, postId, shiftId, siteId } from '@/shared/mocks/world';
import type { TasksApi } from './api';
import { TASK_STATUSES, type Task, type TaskReport, type TaskStatus } from './types';

type Seed = {
  title: string;
  site: number;
  post: number;
  /** Employee index, null = nobody claimed it yet. */
  employee: number | null;
  status: TaskStatus;
  /** Minutes from now (negative = past). */
  deadline: number;
  perShift?: boolean;
};

const SEEDS: readonly Seed[] = [
  { title: 'Ronda de verificación de cámaras', site: 0, post: 2, employee: 2, status: 'PENDING', deadline: 40, perShift: true },
  { title: 'Control de acceso de proveedores', site: 0, post: 0, employee: 0, status: 'COMPLETED', deadline: -90 },
  { title: 'Inspección de extintores', site: 0, post: 1, employee: 1, status: 'PENDING', deadline: 180 },
  { title: 'Revisión de iluminación perimetral', site: 0, post: 1, employee: null, status: 'EXPIRED', deadline: -240 },
  { title: 'Registro de novedades del turno', site: 1, post: 0, employee: 4, status: 'COMPLETED', deadline: -30, perShift: true },
  { title: 'Control de precintos de camiones', site: 1, post: 1, employee: 5, status: 'PENDING', deadline: 75 },
  { title: 'Verificación de alarmas de muelle', site: 1, post: 0, employee: 4, status: 'COMPLETED', deadline: -200 },
  { title: 'Chequeo de rutas de evacuación', site: 1, post: 2, employee: 6, status: 'EXPIRED', deadline: -120 },
  { title: 'Control de acceso a urgencias', site: 2, post: 0, employee: 8, status: 'COMPLETED', deadline: -60, perShift: true },
  { title: 'Revisión de botiquines', site: 2, post: 1, employee: 9, status: 'PENDING', deadline: 20 },
  { title: 'Inspección del estacionamiento', site: 2, post: 2, employee: null, status: 'PENDING', deadline: 110 },
  { title: 'Control de llaves de sectores', site: 2, post: 1, employee: 9, status: 'EXPIRED', deadline: -300 },
  { title: 'Registro de visitas ejecutivas', site: 3, post: 0, employee: 11, status: 'COMPLETED', deadline: -45, perShift: true },
  { title: 'Control de ascensores de servicio', site: 3, post: 1, employee: 10, status: 'COMPLETED', deadline: -150 },
  { title: 'Verificación de credenciales', site: 3, post: 0, employee: 11, status: 'PENDING', deadline: 240 },
  { title: 'Auditoría de libro de actas', site: 3, post: 1, employee: null, status: 'CANCELLED', deadline: -400 },
];

const TASKS: Task[] = SEEDS.map((seed, index) => ({
  id: mockId(8, index + 1),
  tenantId: TENANT_ID,
  kind: seed.perShift ? 'PER_SHIFT' : 'SINGLE',
  status: seed.status,
  title: seed.title,
  deadline: minutesFromNow(seed.deadline),
  employeeId: seed.employee === null ? null : employeeId(seed.employee),
  claimedAt: seed.employee === null ? null : minutesFromNow(seed.deadline - 120),
  siteId: siteId(seed.site),
  postId: postId(seed.site, seed.post),
  shiftId: seed.perShift ? shiftId(seed.site, seed.post, 'current') : null,
  createdAt: minutesFromNow(-600),
}));

function buildReport(tasks: Task[]): TaskReport {
  const byStatus = Object.fromEntries(
    TASK_STATUSES.map((status) => [status, tasks.filter((task) => task.status === status).length]),
  ) as Record<TaskStatus, number>;
  const closed = byStatus.COMPLETED + byStatus.EXPIRED;

  return {
    total: tasks.length,
    byStatus,
    complianceRate: closed === 0 ? 0 : byStatus.COMPLETED / closed,
    bySite: Array.from({ length: SITE_COUNT - 1 }, (_, site) => {
      const siteTasks = tasks.filter((task) => task.siteId === siteId(site));
      return {
        siteId: siteId(site),
        total: siteTasks.length,
        completed: siteTasks.filter((task) => task.status === 'COMPLETED').length,
        expired: siteTasks.filter((task) => task.status === 'EXPIRED').length,
        pending: siteTasks.filter((task) => task.status === 'PENDING').length,
      };
    }),
  };
}

export const tasksMockApi: TasksApi = {
  listTasks: (query = {}) =>
    mockResponse(
      TASKS.filter(
        (task) =>
          (!query.status || task.status === query.status) &&
          (!query.siteId || task.siteId === query.siteId) &&
          (!query.employeeId || task.employeeId === query.employeeId),
      ).sort((a, b) => a.deadline.localeCompare(b.deadline)),
    ),
  getTaskReport: () => mockResponse(buildReport(TASKS)),
};
