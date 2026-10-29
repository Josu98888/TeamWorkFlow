/**
 * Shared identifiers of the demo "world".
 *
 * `organization` (core) owns sites, posts, employees and shifts; `telemetry` replicates shifts and
 * references the same ids. The domain mocks must agree on those ids, so they live here (mock-only,
 * never imported by real HTTP code).
 */

/** UUID-v7-shaped id: `kind` selects the entity family, `n` the row. */
export const mockId = (kind: number, n: number) =>
  `01900000-0000-7000-8000-${String(kind).padStart(4, '0')}${String(n).padStart(8, '0')}`;

export const TENANT_ID = mockId(1, 1);
export const MOCK_USER_ID = mockId(7, 1);
export const MOCK_TIMEZONE = 'America/Argentina/Buenos_Aires';

export const siteId = (site: number) => mockId(2, site + 1);
export const postId = (site: number, post: number) => mockId(3, (site + 1) * 10 + post + 1);
export const employeeId = (employee: number) => mockId(4, employee + 1);

/** Shift slots around "now": the previous, the one in progress and the next one of a post. */
export const SHIFT_SLOTS = ['previous', 'current', 'next'] as const;
export type ShiftSlot = (typeof SHIFT_SLOTS)[number];
export const shiftId = (site: number, post: number, slot: ShiftSlot) =>
  mockId(5, (site + 1) * 100 + (post + 1) * 10 + SHIFT_SLOTS.indexOf(slot));

export const alertId = (n: number) => mockId(6, n);

export const SITE_COUNT = 5;

/** Posts per site (index = site). The last site is inactive and has no shift in progress. */
export const POSTS_PER_SITE = [3, 3, 3, 2, 2] as const;

/** Employees enabled per site (indexes into the employee list). */
export const SITE_EMPLOYEES: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [3, 4, 5, 6, 7],
  [8, 9, 2],
  [10, 11, 0],
  [1, 5],
];

/** Who covers each post right now: employee index (null = uncovered) and whether they clocked in. */
export type CurrentAssignment = { site: number; post: number; employee: number | null; clockedIn: boolean };

export const CURRENT_ASSIGNMENTS: readonly CurrentAssignment[] = [
  { site: 0, post: 0, employee: 0, clockedIn: true },
  { site: 0, post: 1, employee: 1, clockedIn: true },
  { site: 0, post: 2, employee: 2, clockedIn: false },
  { site: 1, post: 0, employee: 4, clockedIn: true },
  { site: 1, post: 1, employee: 5, clockedIn: true },
  { site: 1, post: 2, employee: 6, clockedIn: true },
  { site: 2, post: 0, employee: 8, clockedIn: true },
  { site: 2, post: 1, employee: 9, clockedIn: false },
  { site: 2, post: 2, employee: null, clockedIn: false },
  { site: 3, post: 0, employee: 11, clockedIn: true },
  { site: 3, post: 1, employee: 10, clockedIn: true },
];
