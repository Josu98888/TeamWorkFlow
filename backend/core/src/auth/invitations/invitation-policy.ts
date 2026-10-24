import type { WireInvitationRole, WireRole } from '../wire';
import { canManageRole, isUserManager } from '../users/user-policy';

// Lifetime of an invitation link (AGENTS § Invitations): 7 days.
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Who can invite which role (AGENTS roles table). The table has one owner,
// `users/user-policy.ts` (S5.1); these wrappers keep the invitation names.
// The actor is trusted as the HTTP layer took it from `auth.token.verify`.
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
