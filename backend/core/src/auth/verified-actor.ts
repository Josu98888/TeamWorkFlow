import type { WirePlan, WireRole, WireTenantStatus } from './wire';

// Result of `auth.token.verify` (AGENTS § Sessions and tokens). Values come
// from the database at verification time, not from the token claims.
export interface VerifiedActor {
  userId: string;
  // Null only for platform_admin, together with tenantStatus, plan, features.
  tenantId: string | null;
  role: WireRole;
  // Present only for supervisor.
  siteIds?: string[];
  tenantStatus: WireTenantStatus | null;
  // Null until the first billing event stores them.
  plan: WirePlan | null;
  features: Record<string, boolean> | null;
}
