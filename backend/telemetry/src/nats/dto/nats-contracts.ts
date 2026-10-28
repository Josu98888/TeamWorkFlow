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
}

export interface SiteDto {
  id: string;
  tenantId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  qrCode?: string;
}

export interface ShiftDto {
  id: string;
  tenantId: string;
  siteId: string;
  postId: string;
  employeeId?: string;
  startsAt: string;
  endsAt: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  version: number;
}
