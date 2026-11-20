'use client';

import { accessApi, ROLE_LABELS } from '@/features/access';
import { EmployeesView } from '@/features/organization';
import type { InviteRoleOption } from '@/features/organization';
import { manageableRoles } from '@/shared/auth/permissions';
import { useSession } from '@/shared/hooks/useSession';

const INVITABLE_ROLES = ['employee', 'supervisor'] as const;

// Wires the auth invitation into the employee form here so the organization and
// access feature domains never import each other.
export default function EmployeesPage() {
  const session = useSession();
  const allowed = manageableRoles(session?.role);
  const inviteRoles: InviteRoleOption[] = INVITABLE_ROLES.filter((role) => allowed.includes(role)).map((role) => ({
    value: role,
    label: ROLE_LABELS[role],
  }));

  return <EmployeesView onInvite={(input) => accessApi.createInvitation(input)} inviteRoles={inviteRoles} />;
}
