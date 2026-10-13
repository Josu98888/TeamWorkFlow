import type { WireRole } from '../common/wire';

// Authorization for the user-management actions of AGENTS § Roles (invite,
// change role, assign sites, deactivate, password reset). Pure on purpose: the
// use cases (S5.2-S5.6) and the invitations reuse it, and the table lives here
// only. Actors and targets are trusted as the service read them: the actor
// from `auth.token.verify` via the gateway, the target from the database
// filtered by the actor's tenant. The policy still compares tenants itself.

export interface PolicyActor {
  userId: string;
  tenantId: string | null;
  role: WireRole;
}

export interface PolicyTarget {
  userId: string;
  tenantId: string | null;
  role: WireRole;
}

// Roles a tenant user can have after a role change (never owner, which is
// unique per tenant, nor platform_admin, which only a seed/CLI creates).
export type ChangeableRole = 'admin' | 'supervisor' | 'employee';

export const CHANGEABLE_ROLES: readonly ChangeableRole[] = [
  'admin',
  'supervisor',
  'employee',
];

// Owner and admin of a tenant are the only roles that manage users.
export function isUserManager(actor: {
  tenantId: string | null;
  role: WireRole;
}): boolean {
  return (
    actor.tenantId !== null &&
    (actor.role === 'owner' || actor.role === 'admin')
  );
}

// Who may act on a user (or invitation) of a given role: the owner on admin,
// supervisor and employee; an admin only on supervisor and employee. Nobody
// manages an owner or a platform_admin through these actions.
export function canManageRole(
  actor: { tenantId: string | null; role: WireRole },
  targetRole: WireRole,
): boolean {
  if (!isUserManager(actor)) return false;

  switch (targetRole) {
    case 'admin':
      return actor.role === 'owner';
    case 'supervisor':
    case 'employee':
      return true;
    default:
      return false;
  }
}

// Common to every action on an existing user: same tenant (both non-null), no
// self-action, and the actor's role may manage the target's role. Owner and
// platform_admin targets fall out in `canManageRole`.
function canActOn(actor: PolicyActor, target: PolicyTarget): boolean {
  return (
    actor.tenantId !== null &&
    target.tenantId === actor.tenantId &&
    target.userId !== actor.userId &&
    canManageRole(actor, target.role)
  );
}

// supervisor <-> employee is owner/admin; any change to or from `admin` is
// owner only. The owner cannot be demoted (not manageable) and nobody becomes
// owner or platform_admin (`newRole` is limited to ChangeableRole).
export function canChangeRole(
  actor: PolicyActor,
  target: PolicyTarget,
  newRole: WireRole,
): boolean {
  if (!(CHANGEABLE_ROLES as readonly WireRole[]).includes(newRole)) {
    return false;
  }
  return canActOn(actor, target) && canManageRole(actor, newRole);
}

// Only a supervisor has a site scope; the actor must be able to manage it.
export function canAssignSites(
  actor: PolicyActor,
  target: PolicyTarget,
): boolean {
  return target.role === 'supervisor' && canActOn(actor, target);
}

// Never the owner, never oneself.
export function canDeactivate(
  actor: PolicyActor,
  target: PolicyTarget,
): boolean {
  return canActOn(actor, target);
}

// Same role rules as deactivating: admin links only by the owner, never for
// an owner or a platform_admin (AGENTS Roles table).
export function canCreatePasswordReset(
  actor: PolicyActor,
  target: PolicyTarget,
): boolean {
  return canActOn(actor, target);
}
