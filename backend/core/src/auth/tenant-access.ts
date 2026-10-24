import {
  TenantCancelledException,
  TenantSuspendedException,
} from '../common/exceptions/app.exceptions';
import type { Role, TenantStatus } from './prisma/generated/enums';

// owner, admin and platform_admin are never blocked by the tenant status;
// supervisor and employee are (AGENTS: Tenant status). Shared by login,
// refresh, verify and invitation accept.
export function assertTenantAllowsAccess(
  role: Role,
  status: TenantStatus | undefined,
): void {
  if (role !== 'SUPERVISOR' && role !== 'EMPLOYEE') return;
  if (status === 'SUSPENDED') throw new TenantSuspendedException();
  if (status === 'CANCELLED') throw new TenantCancelledException();
}
