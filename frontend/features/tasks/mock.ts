import { minutesFromNow, mockResponse } from '@/shared/lib/mock';
import { TENANT_ID, employeeId, mockId, postId, shiftId, siteId } from '@/shared/mocks/world';
import type { TasksApi } from './api';
import { buildTaskReport } from './report';
import { ApiError } from '@/shared/lib/http';
import { formsMock, mockFormVersions } from './mock-forms';
import type { FormField, MediaUpload, Task, TaskStatus } from './types';

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

const VERSIONS = mockFormVersions();

function buildSeedAnswer(taskId: string, fields: FormField[], offsetMinutes: number): Task['answer'] {
  const answers: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === 'yes_no') answers[field.key] = true;
    else if (field.type === 'number') answers[field.key] = field.min ?? 1;
    else if (field.type === 'select') answers[field.key] = field.options?.[0] ?? 'Conforme';
    else if (field.type === 'checklist') answers[field.key] = field.options?.slice(0, 2) ?? ['Verificado'];
    else if (field.type === 'qr') answers[field.key] = 'QR-PUESTO-OK';
    else if (field.type === 'photo') answers[field.key] = `media_${taskId.slice(-6)}`;
    else answers[field.key] = 'Sin novedades durante la recorrida.';
  }
  return {
    id: mockId(11, Math.abs(offsetMinutes) + 1),
    taskId,
    answers,
    deviceTime: minutesFromNow(offsetMinutes - 5),
    receivedAt: minutesFromNow(offsetMinutes - 4),
    reviewResult: 'NONE',
    reviewNote: null,
  };
}

const TASKS: Task[] = SEEDS.map((seed, index) => {
  const id = mockId(8, index + 1);
  const version = VERSIONS[index % VERSIONS.length];
  return {
    id,
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
    formVersionId: version.id,
    formVersion: version,
    expectedQr: null,
    answer: seed.status === 'COMPLETED' ? buildSeedAnswer(id, version.fields, seed.deadline) : null,
  };
});

/** The demo employee: owns the pending seeded task of employee 2 and can claim the unclaimed ones. */
const MY_EMPLOYEE_ID = employeeId(2);

function findOpenTask(taskId: string): Task {
  const task = TASKS.find((item) => item.id === taskId);
  if (!task) throw new ApiError(404, 'task_not_found', 'Task not found');
  if (task.status !== 'PENDING') throw new ApiError(409, 'task_not_open', 'Task is not open');
  return task;
}

export const tasksMockApi: TasksApi = {
  ...formsMock,
  listTasks: (query = {}) =>
    mockResponse(
      TASKS.filter(
        (task) =>
          (!query.status || task.status === query.status) &&
          (!query.siteId || task.siteId === query.siteId) &&
          (!query.employeeId || task.employeeId === query.employeeId),
      ).sort((a, b) => a.deadline.localeCompare(b.deadline)),
    ),
  getTaskReport: () => mockResponse(buildTaskReport(TASKS)),
  listMyTasks: () =>
    mockResponse(
      TASKS.filter((task) => task.status === 'PENDING' && (task.employeeId === null || task.employeeId === MY_EMPLOYEE_ID)).sort(
        (a, b) => a.deadline.localeCompare(b.deadline),
      ),
    ),
  claimTask: (taskId) => {
    try {
      const task = findOpenTask(taskId);
      if (task.employeeId !== null && task.employeeId !== MY_EMPLOYEE_ID) throw new ApiError(409, 'task_already_claimed', 'Task already claimed');
      task.employeeId = MY_EMPLOYEE_ID;
      task.claimedAt = task.claimedAt ?? new Date().toISOString();
      return mockResponse({ ...task });
    } catch (cause) {
      return Promise.reject(cause);
    }
  },
  answerTask: (taskId, input) => {
    try {
      const task = findOpenTask(taskId);
      const qrField = task.formVersion?.fields.find((field) => field.type === 'qr');
      if (task.expectedQr && qrField && input.answers[qrField.key] !== task.expectedQr) {
        throw new ApiError(422, 'qr_mismatch', 'Scanned QR code does not match expected QR');
      }
      task.employeeId = MY_EMPLOYEE_ID;
      task.status = 'COMPLETED';
      task.answer = {
        id: mockId(11, TASKS.length),
        taskId,
        answers: input.answers,
        deviceTime: input.deviceTime,
        receivedAt: new Date().toISOString(),
        reviewResult: 'NONE',
        reviewNote: null,
      };
      return mockResponse({ ...task });
    } catch (cause) {
      return Promise.reject(cause);
    }
  },
  reviewTask: (taskId, input) => {
    const task = TASKS.find((item) => item.id === taskId);
    if (!task) return Promise.reject(new ApiError(404, 'task_not_found', 'Task not found'));
    if (!task.answer) return Promise.reject(new ApiError(409, 'task_not_answered', 'Task has no answer to review'));
    task.answer = {
      ...task.answer,
      reviewResult: input.result,
      reviewNote: input.note?.trim() || null,
    };
    return mockResponse({ ...task });
  },
  requestUpload: (): Promise<MediaUpload> =>
    mockResponse({ mediaId: crypto.randomUUID(), uploadUrl: 'mock://storage/upload', expiresAt: minutesFromNow(5) }),
  uploadFile: () => mockResponse(undefined),
  createTask: (input) => {
    const version = mockFormVersions().find((item) => item.id === input.formVersionId);
    if (!version) return Promise.reject(new ApiError(409, 'form_not_published', 'Form version is not published'));
    const task: Task = {
      id: mockId(8, TASKS.length + 1),
      tenantId: TENANT_ID,
      kind: 'SINGLE',
      status: 'PENDING',
      title: input.title?.trim() || version.name,
      deadline: input.deadline,
      employeeId: input.employeeId ?? null,
      claimedAt: null,
      siteId: input.siteId,
      postId: input.postId,
      shiftId: null,
      createdAt: new Date().toISOString(),
      formVersionId: version.id,
      formVersion: version,
      expectedQr: input.expectedQr ?? null,
      answer: null,
    };
    TASKS.push(task);
    return mockResponse(task);
  },
};