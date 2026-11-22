export type Role =
  | 'owner'
  | 'admin'
  | 'supervisor'
  | 'employee'
  | 'platform_admin';

export type TenantStatus =
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled';

export type Plan = 'basic' | 'pro';

export interface VerifiedActor {
  userId: string;
  tenantId: string;
  role: Role;
  siteIds: string[];
  tenantStatus: TenantStatus;
  plan: Plan;
  features: {
    alerts?: boolean;
    tower?: boolean;
    payroll_reports?: boolean;
    [key: string]: boolean | undefined;
  };
  exp?: number;
}

export interface EmployeeDto {
  id: string;
  userId: string;
  tenantId: string;
  firstName?: string;
  lastName?: string;
  employeeNumber?: string | null;
  isActive?: boolean;
}

export interface EmployeeCatalogDto {
  id: string;
  userId: string | null;
  tenantId: string;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  isActive: boolean;
}

export interface SiteDto {
  id: string;
  tenantId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  qrCode?: string;
  timezone?: string;
  isActive?: boolean;
}

export interface PostDto {
  id: string;
  tenantId: string;
  siteId: string;
  name: string;
  isActive: boolean;
}

export interface ShiftDto {
  id: string;
  tenantId: string;
  siteId: string;
  postId: string;
  employeeId?: string | null;
  startsAt: string;
  endsAt: string;
  authorizedOvertimeMinutes?: number;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  version: number;
}
