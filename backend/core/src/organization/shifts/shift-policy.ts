import { ForbiddenException } from '../../common/exceptions/app.exceptions';
import type { OrganizationActor } from '../organization-actor';
import { requireTenantActor, type TenantActor } from '../sites/site-policy';

// Create/edit/cancel/reassign single shifts: owner, admin and supervisor
// (the supervisor only inside `siteIds`, see `canManageSite`).
export function requireShiftManager(actor: OrganizationActor): TenantActor {
  const tenantActor = requireTenantActor(actor);
  if (tenantActor.role === 'employee') {
    throw new ForbiddenException();
  }
  return tenantActor;
}

// Owner/admin: every site of the tenant. Supervisor: only `siteIds`.
export function canManageSite(actor: TenantActor, siteId: string): boolean {
  if (actor.role === 'supervisor') {
    return (actor.siteIds ?? []).includes(siteId);
  }
  return true;
}
