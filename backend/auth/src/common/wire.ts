import type {
  InvitationRole,
  Plan,
  Role,
  TenantStatus,
} from '../generated/prisma/enums';

// Single owner of the conversion between Prisma enums (internal to auth, e.g.
// `OWNER`) and the lowercase values that leave the service (JWT claims, event
// payloads, `auth.token.verify`), as documented in AGENTS.md. Never send a
// Prisma enum value over the wire without going through this module.

export type WireRole =
  'owner' | 'admin' | 'supervisor' | 'employee' | 'platform_admin';

export const WIRE_ROLES: readonly WireRole[] = [
  'owner',
  'admin',
  'supervisor',
  'employee',
  'platform_admin',
];

// Roles that can be invited (never owner or platform_admin).
export type WireInvitationRole = 'admin' | 'supervisor' | 'employee';

export const WIRE_INVITATION_ROLES: readonly WireInvitationRole[] = [
  'admin',
  'supervisor',
  'employee',
];

export type WireTenantStatus =
  'active' | 'past_due' | 'suspended' | 'cancelled' | 'deleted';

export type WirePlan = 'basic' | 'pro';

const ROLE_TO_WIRE: Record<Role, WireRole> = {
  OWNER: 'owner',
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  EMPLOYEE: 'employee',
  PLATFORM_ADMIN: 'platform_admin',
};

const ROLE_FROM_WIRE: Record<WireRole, Role> = {
  owner: 'OWNER',
  admin: 'ADMIN',
  supervisor: 'SUPERVISOR',
  employee: 'EMPLOYEE',
  platform_admin: 'PLATFORM_ADMIN',
};

const INVITATION_ROLE_FROM_WIRE: Record<WireInvitationRole, InvitationRole> = {
  admin: 'ADMIN',
  supervisor: 'SUPERVISOR',
  employee: 'EMPLOYEE',
};

const INVITATION_ROLE_TO_WIRE: Record<InvitationRole, WireInvitationRole> = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  EMPLOYEE: 'employee',
};

const TENANT_STATUS_TO_WIRE: Record<TenantStatus, WireTenantStatus> = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  DELETED: 'deleted',
};

const PLAN_TO_WIRE: Record<Plan, WirePlan> = {
  BASIC: 'basic',
  PRO: 'pro',
};

const PLAN_FROM_WIRE: Record<WirePlan, Plan> = {
  basic: 'BASIC',
  pro: 'PRO',
};

// For untrusted input such as JWT claims.
export const isWireRole = (value: unknown): value is WireRole =>
  typeof value === 'string' && Object.hasOwn(ROLE_FROM_WIRE, value);

export const toWireRole = (role: Role): WireRole => ROLE_TO_WIRE[role];

export const fromWireRole = (role: WireRole): Role => ROLE_FROM_WIRE[role];

export const toWireTenantStatus = (status: TenantStatus): WireTenantStatus =>
  TENANT_STATUS_TO_WIRE[status];

export const toWirePlan = (plan: Plan): WirePlan => PLAN_TO_WIRE[plan];

// For billing events, whose `plan` arrives as a wire value.
export const fromWirePlan = (plan: WirePlan): Plan => PLAN_FROM_WIRE[plan];

export const fromWireInvitationRole = (
  role: WireInvitationRole,
): InvitationRole => INVITATION_ROLE_FROM_WIRE[role];

export const toWireInvitationRole = (
  role: InvitationRole,
): WireInvitationRole => INVITATION_ROLE_TO_WIRE[role];
