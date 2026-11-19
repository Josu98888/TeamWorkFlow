// Mirrors the `tasks` module of core (`backend/core/src/tasks`, DTOs in `http/dto/tasks.dto.ts`).
// Enum values are the Prisma enums (uppercase).

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
  formVersionId?: string;
  /** The answer to a `qr` field must match it when set. */
  expectedQr?: string | null;
  /** Embedded by `GET /tasks` and `GET /tasks/:taskId`. */
  formVersion?: FormVersion;
  answer?: TaskAnswer | null;
};

export type TaskAnswer = {
  id: string;
  taskId: string;
  answers: Record<string, unknown>;
  deviceTime: string;
  receivedAt: string;
  reviewResult: 'NONE' | 'APPROVED' | 'OBSERVED';
  reviewNote: string | null;
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

// ---------------------------------------------------------------------------------------------
// Forms (`/api/v1/forms`, owner/admin write). Field rules: `domain/form-validator.ts`.
// ---------------------------------------------------------------------------------------------

export const FORM_FIELD_TYPES = ['text', 'number', 'yes_no', 'select', 'checklist', 'photo', 'qr'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export type FormField = {
  /** Stable identifier of the answer; unique inside the form. */
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** Only for `select` and `checklist` (non-empty). */
  options?: string[];
  /** Only for `number`. */
  min?: number;
  max?: number;
};

/** Immutable snapshot created by `POST /forms/:formId/publish`. */
export type FormVersion = {
  id: string;
  tenantId: string;
  formId: string;
  version: number;
  name: string;
  fields: FormField[];
  publishedAt: string;
  publishedBy: string;
};

/** `GET /forms` (without `versions`) and `GET /forms/:formId` (with `versions`, newest first). */
export type Form = {
  id: string;
  tenantId: string;
  name: string;
  draftFields: FormField[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  versions?: FormVersion[];
};

export type FormsPage = { items: Form[]; total: number };

/** Body of `POST /forms` and `PATCH /forms/:formId` (the PATCH accepts partial bodies; the builder always sends both). */
export type FormInput = { name: string; fields: FormField[] };
