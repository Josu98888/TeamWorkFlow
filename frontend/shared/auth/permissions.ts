// Single source of truth for role-based UI access. Pure module (no React/Next imports) so it can be
// used by `proxy.ts`, server code and client components alike.
//
// The backend is the real enforcement; this table only mirrors it to route, hide and disable things
// before a call is made. When a backend rule changes, change it here (and nowhere else in the UI).
//
// The JWT `role` claim is the lowercase wire role (`backend/core/src/auth/wire.ts`, `toWireRole`).

export const ROLES = ['owner', 'admin', 'supervisor', 'employee', 'platform_admin'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export type Capability =
  | 'dashboard.view'
  | 'tower.view'
  | 'alerts.manage'
  | 'sites.view'
  | 'sites.manage'
  | 'employees.view'
  | 'employees.manage'
  | 'shifts.view'
  | 'shifts.manage'
  | 'tasks.view'
  | 'users.manage'
  | 'billing.manage'
  | 'platform.billing'
  | 'attendance.view'
  | 'attendance.correct'
  | 'clock.self'
  | 'workdays.self';

const OWNER_ADMIN: readonly Role[] = ['owner', 'admin'];
const MANAGERS: readonly Role[] = ['owner', 'admin', 'supervisor'];
const EMPLOYEE_ONLY: readonly Role[] = ['employee'];
const PLATFORM_ONLY: readonly Role[] = ['platform_admin'];

/** Roles holding each capability, with the backend rule it mirrors. `platform_admin` holds none (no tenant). */
const CAPABILITY_ROLES: Record<Capability, readonly Role[]> = {
  // No backend rule: the overview aggregates sites, tower and tasks, which employees cannot read.
  'dashboard.view': MANAGERS,
  // telemetry `tower.controller.ts`: @Roles('supervisor', 'admin', 'owner').
  'tower.view': MANAGERS,
  // telemetry `alerts.controller.ts` (list, acknowledge, resolve): @Roles('supervisor', 'admin', 'owner').
  'alerts.manage': MANAGERS,
  // core `sites/site-policy.ts` `canReadSites`: everyone but employee (supervisor only inside `siteIds`).
  'sites.view': MANAGERS,
  // core `sites/site-policy.ts` `requireSiteManager`: create/edit sites and posts, rotate QR (owner, admin).
  'sites.manage': OWNER_ADMIN,
  // core `employees` list: owner/admin whole tenant, supervisor their sites; employee only their own profile.
  'employees.view': MANAGERS,
  // core `employees/employee-policy.ts` `requireEmployeeManager`: owner, admin.
  'employees.manage': OWNER_ADMIN,
  // core `shifts/shifts.service.ts` `visibility`: owner/admin tenant, supervisor `siteIds`, employee own shifts.
  'shifts.view': MANAGERS,
  // core `shifts/shift-policy.ts` `requireShiftManager`: everyone but employee (supervisor inside `siteIds`).
  'shifts.manage': MANAGERS,
  // core `tasks/AGENTS.md` role table (task screens for employees are not built yet).
  'tasks.view': MANAGERS,
  // core `auth/users/user-policy.ts` `isUserManager` + `invitations/invitation-policy.ts`: owner, admin.
  'users.manage': OWNER_ADMIN,
  // core `billing/billing.service.ts` `assertTenantRole`: plans, subscription, invoices, payment links, change
  // plan/cancel/resubscribe are owner/admin of the tenant only (a platform_admin gets 403 there).
  'billing.manage': OWNER_ADMIN,
  // core `billing/billing.service.ts` `assertPlatformAdmin`: every `/billing/admin/*` route is platform_admin only.
  'platform.billing': PLATFORM_ONLY,
  // telemetry `clock-ins.controller.ts` GET + `workdays.controller.ts`: all tenant roles; this is the
  // team-wide screen, so supervisor/admin/owner (employees use `/mi-jornada`).
  'attendance.view': MANAGERS,
  // telemetry `clock-ins.controller.ts` POST manual + PATCH :id: @Roles('supervisor', 'admin', 'owner').
  'attendance.correct': MANAGERS,
  // telemetry `clock-ins.controller.ts` POST /clock-events: @Roles('employee').
  'clock.self': EMPLOYEE_ONLY,
  // telemetry `workdays.controller.ts` + GET /clock-events as employee (scoped to own records).
  'workdays.self': EMPLOYEE_ONLY,
};

/** Role -> capabilities view of the table above (derived, for display and debugging). */
export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = Object.fromEntries(
  ROLES.map((role) => [
    role,
    (Object.keys(CAPABILITY_ROLES) as Capability[]).filter((capability) => CAPABILITY_ROLES[capability].includes(role)),
  ]),
) as unknown as Record<Role, readonly Capability[]>;

export function can(role: string | null | undefined, capability: Capability): boolean {
  return isRole(role) && CAPABILITY_ROLES[capability].includes(role);
}

/** Route prefix -> capability required to open it. A route without a rule is open to any signed-in user. */
export const ROUTE_RULES: readonly { path: string; exact?: boolean; capability: Capability }[] = [
  { path: '/', exact: true, capability: 'dashboard.view' },
  { path: '/torre-control', capability: 'tower.view' },
  { path: '/sedes', capability: 'sites.view' },
  { path: '/tareas', capability: 'tasks.view' },
  { path: '/empleados', capability: 'employees.view' },
  { path: '/turnos', capability: 'shifts.view' },
  { path: '/asistencia', capability: 'attendance.view' },
  { path: '/usuarios', capability: 'users.manage' },
  { path: '/mi-jornada', capability: 'clock.self' },
  { path: '/facturacion', capability: 'billing.manage' },
  { path: '/plataforma', capability: 'platform.billing' },
];

export function canAccessRoute(role: string | null | undefined, pathname: string): boolean {
  const rule = ROUTE_RULES.find((entry) =>
    entry.exact ? pathname === entry.path : pathname === entry.path || pathname.startsWith(`${entry.path}/`),
  );
  return rule ? can(role, rule.capability) : true;
}

export const NO_ACCESS_PATH = '/sin-acceso';

/** Landing page of a role. `platform_admin` (no tenant) lands on platform billing; unknown roles on "sin acceso". */
export function homeFor(role: string | null | undefined): string {
  if (role === 'employee') return '/mi-jornada';
  if (role === 'owner' || role === 'admin' || role === 'supervisor') return '/';
  if (role === 'platform_admin') return '/plataforma/facturacion';
  return NO_ACCESS_PATH;
}

/** Roles the actor may invite or assign (mirrors `canManageRole` in core `auth/users/user-policy.ts`). */
export function manageableRoles(actorRole: string | null | undefined): readonly ('admin' | 'supervisor' | 'employee')[] {
  if (actorRole === 'owner') return ['admin', 'supervisor', 'employee'];
  if (actorRole === 'admin') return ['supervisor', 'employee'];
  return [];
}
