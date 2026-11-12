import { ForbiddenException } from '../../common/exceptions/app.exceptions';
import type { OrganizationActor } from '../organization-actor';

// Actor narrowed to a real tenant: platform_admin (tenantId null) is refused.
export interface TenantActor extends OrganizationActor {
  tenantId: string;
}

export function requireTenantActor(actor: OrganizationActor): TenantActor {
  if (actor.tenantId === null || actor.role === 'platform_admin') {
    throw new ForbiddenException();
  }
  return actor as TenantActor;
}

// Create/edit sites and posts, rotate the QR: owner and admin only.
export function requireSiteManager(actor: OrganizationActor): TenantActor {
  const tenantActor = requireTenantActor(actor);
  if (tenantActor.role !== 'owner' && tenantActor.role !== 'admin') {
    throw new ForbiddenException();
  }
  return tenantActor;
}

// Employees read neither sites nor posts here ("own profile and own shifts
// only"): they get an empty list or a 404, never a 403, so a site id cannot be
// probed.
export function canReadSites(actor: TenantActor): boolean {
  return actor.role !== 'employee';
}

// Owner/admin see every site of the tenant; a supervisor only `siteIds`.
export function canAccessSite(actor: TenantActor, siteId: string): boolean {
  if (!canReadSites(actor)) return false;
  if (actor.role === 'supervisor') {
    return (actor.siteIds ?? []).includes(siteId);
  }
  return true;
}

// The QR is printed at the site: never shown to an employee actor.
export function canSeeQrCode(actor: TenantActor): boolean {
  return actor.role !== 'employee';
}

export function isIanaTimezone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  // Offsets such as "+01:00" are valid for Intl but are not IANA zone names.
  if (/^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
