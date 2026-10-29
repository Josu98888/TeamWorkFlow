// The caller as `organization` sees it: built by the HTTP layer from the
// verified actor, never from client input. `siteIds` is present only for
// supervisors. Kept local so the module does not import `auth` internals.
export type OrganizationRole =
  | 'owner'
  | 'admin'
  | 'supervisor'
  | 'employee'
  | 'platform_admin';

export interface OrganizationActor {
  userId: string;
  // Null only for platform_admin, which every tenant operation refuses.
  tenantId: string | null;
  role: OrganizationRole;
  siteIds?: string[];
}

// Copies only the fields the module documents; plan, features and tenant
// status never reach the services.
export function toOrganizationActor(
  actor: OrganizationActor,
): OrganizationActor {
  const result: OrganizationActor = {
    userId: actor.userId,
    tenantId: actor.tenantId,
    role: actor.role,
  };
  if (actor.siteIds) {
    result.siteIds = [...actor.siteIds];
  }
  return result;
}
