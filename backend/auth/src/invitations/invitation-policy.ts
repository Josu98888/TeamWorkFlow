import type { WireInvitationRole, WireRole } from '../common/wire';

// Who can invite which role (AGENTS roles table). Pure on purpose so the
// regenerate use case (S4.3) reuses it; S5.1 may fold it into the user policy.
// The actor is trusted as the gateway took it from `auth.token.verify`.
export function canInvite(
  actor: { tenantId: string | null; role: WireRole },
  role: WireInvitationRole,
): boolean {
  // platform_admin belongs to no tenant and has none of these actions.
  if (actor.tenantId === null) return false;

  switch (actor.role) {
    case 'owner':
      return true;
    case 'admin':
      return role === 'supervisor' || role === 'employee';
    default:
      return false;
  }
}
