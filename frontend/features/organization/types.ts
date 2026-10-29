// Mirrors the wire format of the `organization` module of `core`
// (branch feat/backend/org-shift-lifecycle: sites, employees and shifts controllers/DTOs).
// Dates are ISO-8601 strings; nullable columns are `X | null`.

/** Lists return `{ items, total }` (query: `page`, `pageSize`). */
export type Paginated<T> = {
  items: T[];
  total: number;
};

/** `GET /sites`, `GET /sites/:siteId`. `qrCode` is absent for employee actors. */
export type Site = {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  /** IANA time zone, e.g. America/Argentina/Buenos_Aires. */
  timezone: string;
  qrCode?: string;
  qrRotatedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** `GET /sites/:siteId/posts` (puestos). */
export type Post = {
  id: string;
  tenantId: string;
  siteId: string;
  name: string;
  requiredSkills: string[];
  minPeople: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** `GET /employees`, `GET /employees/:employeeId`. The national id is hidden from supervisors. */
export type Employee = {
  id: string;
  tenantId: string;
  userId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarMediaId: string | null;
  employeeNumber: string | null;
  /** Absent when the actor may not see it. */
  nationalId?: string | null;
  skills: string[];
  weeklyHoursLimit: number | null;
  /** Ids of the sites the employee is enabled in (`PATCH /employees/:employeeId` replaces the set). */
  siteIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export const SHIFT_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'FINISHED', 'CANCELLED'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

/** `GET /shifts`, `GET /shifts/:shiftId`. Writes carry the `version` the caller read. */
export type Shift = {
  id: string;
  tenantId: string;
  templateId: string | null;
  siteId: string;
  postId: string;
  employeeId: string | null;
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ListSitesQuery = { page?: number; pageSize?: number };
export type ListEmployeesQuery = { siteId?: string; isActive?: boolean; search?: string; page?: number; pageSize?: number };
export type ListShiftsQuery = { siteId?: string; employeeId?: string; day?: string; page?: number; pageSize?: number };
