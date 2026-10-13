import type { WireInvitationRole, WireRole } from '../common/wire';
import { canManageRole, isUserManager } from '../users/user-policy';

// Who can invite which role (AGENTS roles table). The table has one owner,
// `users/user-policy.ts` (S5.1); these wrappers keep the invitation names.
// The actor is trusted as the gateway took it from `auth.token.verify`.
export function canInvite(
  actor: { tenantId: string | null; role: WireRole },
  role: WireInvitationRole,
): boolean {
  return canManageRole(actor, role);
}

// Listing pending invitations: owner and admin of a tenant (AGENTS roles table).
export function canListInvitations(actor: {
  tenantId: string | null;
  role: WireRole;
}): boolean {
  return isUserManager(actor);
}
