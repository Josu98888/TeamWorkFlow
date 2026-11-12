import { ForbiddenException } from '../../common/exceptions/app.exceptions';
import type { OrganizationActor } from '../organization-actor';
import { requireTenantActor, type TenantActor } from '../sites/site-policy';

// Create/edit employees and enable sites: owner and admin only.
export function requireEmployeeManager(actor: OrganizationActor): TenantActor {
  const tenantActor = requireTenantActor(actor);
  if (tenantActor.role !== 'owner' && tenantActor.role !== 'admin') {
    throw new ForbiddenException();
  }
  return tenantActor;
}

// The national id (DNI) is shown to owner/admin and to the employee on their
// own profile, never to a supervisor.
export function canSeeNationalId(
  actor: TenantActor,
  employeeUserId: string | null,
): boolean {
  if (actor.role === 'owner' || actor.role === 'admin') return true;
  return employeeUserId !== null && employeeUserId === actor.userId;
}
