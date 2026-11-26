import { organizationApi } from './api';
import { WEEKDAY_SHORT_LABELS } from './labels';
import type { Employee, Post, ShiftTemplate, Site } from './types';

export type SortDirection = 'asc' | 'desc';
export type WorkerSortField = 'name' | 'dni';

export type TurnosSearchFilters = {
  siteQuery?: string;
  postQuery?: string;
  employeeQuery?: string;
  dniQuery?: string;
};

/** Parses `HH:mm` into minutes since midnight (`0..1439`). */
export function parseClockMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Computes shift duration in minutes (`1..1440`), treating end <= start as overnight. */
export function computeDurationMinutes(startTime: string, endTime: string): number {
  const start = parseClockMinutes(startTime);
  const end = parseClockMinutes(endTime);
  const diff = end - start;
  return diff > 0 ? diff : diff + 1440;
}

/** Formats wall-clock `HH:mm` end time from start time + durationMinutes. */
export function formatEndClock(startTime: string, durationMinutes: number): string {
  const total = parseClockMinutes(startTime) + durationMinutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function isOvernightSchedule(startTime: string, durationMinutes: number): boolean {
  return parseClockMinutes(startTime) + durationMinutes > 1440;
}

export function formatScheduleRange(startTime: string, durationMinutes: number): string {
  const end = formatEndClock(startTime, durationMinutes);
  return isOvernightSchedule(startTime, durationMinutes) ? `${startTime} – ${end} (+1d)` : `${startTime} – ${end}`;
}

export function formatWeekdaysSummary(weekdays: readonly number[]): string {
  const sorted = [...new Set(weekdays)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Todos los días';
  if (sorted.length === 5 && sorted[0] === 1 && sorted[4] === 5) return 'Lun a Vie';
  return sorted.map((day) => WEEKDAY_SHORT_LABELS[day] ?? String(day)).join(', ');
}

function normalizeDni(value: string): string {
  return value.trim().replace(/[\s.]/g, '').toLowerCase();
}

export function employeeFullName(employee: Pick<Employee, 'firstName' | 'lastName'>): string {
  return `${employee.lastName}, ${employee.firstName}`.trim();
}

export function matchesText(haystack: string, needle: string): boolean {
  const clean = needle.trim().toLowerCase();
  return clean.length === 0 || haystack.toLowerCase().includes(clean);
}

export function matchesEmployeeName(employee: Employee | undefined, query: string): boolean {
  const clean = query.trim().toLowerCase();
  if (clean.length === 0) return true;
  if (!employee) return false;
  const combined = `${employee.firstName} ${employee.lastName} ${employee.firstName}`.toLowerCase();
  return combined.includes(clean) || employee.email.toLowerCase().includes(clean);
}

export function matchesEmployeeDni(employee: Employee | undefined, dniQuery: string): boolean {
  const clean = normalizeDni(dniQuery);
  if (clean.length === 0) return true;
  if (!employee?.nationalId) return false;
  return normalizeDni(employee.nationalId).includes(clean);
}

export function compareEmployeesByName(
  a: Employee | undefined,
  b: Employee | undefined,
  direction: SortDirection,
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const cmp = employeeFullName(a).localeCompare(employeeFullName(b), 'es', { sensitivity: 'base' });
  return direction === 'asc' ? cmp : -cmp;
}

export function compareEmployeesByDni(
  a: Employee | undefined,
  b: Employee | undefined,
  direction: SortDirection,
): number {
  const aDni = a?.nationalId ? normalizeDni(a.nationalId) : '';
  const bDni = b?.nationalId ? normalizeDni(b.nationalId) : '';
  if (!aDni && !bDni) return 0;
  if (!aDni) return 1;
  if (!bDni) return -1;
  const cmp = aDni.localeCompare(bDni, 'es', { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? cmp : -cmp;
}

const PAGE_BATCH = 100;
const MAX_PAGES = 10;

async function fetchAllPages<T>(loadPage: (page: number) => Promise<{ items: T[]; total: number }>): Promise<T[]> {
  const first = await loadPage(1);
  if (first.items.length >= first.total) return first.items;
  const all = [...first.items];
  for (let page = 2; page <= MAX_PAGES && all.length < first.total; page++) {
    const next = await loadPage(page);
    if (next.items.length === 0) break;
    all.push(...next.items);
  }
  return all;
}

export function fetchAllSites(): Promise<Site[]> {
  return fetchAllPages((page) => organizationApi.listSites({ page, pageSize: PAGE_BATCH }));
}

export function fetchAllEmployees(siteId?: string): Promise<Employee[]> {
  return fetchAllPages((page) => organizationApi.listEmployees({ siteId, page, pageSize: PAGE_BATCH }));
}

export function fetchAllTemplates(query?: { siteId?: string; postId?: string }): Promise<ShiftTemplate[]> {
  return fetchAllPages((page) => organizationApi.listShiftTemplates({ ...query, page, pageSize: PAGE_BATCH }));
}

export function fetchAllPostsForSite(siteId: string): Promise<Post[]> {
  return fetchAllPages((page) => organizationApi.listPosts(siteId, { page, pageSize: PAGE_BATCH }));
}
