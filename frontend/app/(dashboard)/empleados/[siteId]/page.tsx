'use client';

import { use } from 'react';
import { accessApi, ROLE_LABELS } from '@/features/access';
import { SiteEmployeesFolderView, type InviteRoleOption } from '@/features/organization';
import { manageableRoles } from '@/shared/auth/permissions';
import { useSession } from '@/shared/hooks/useSession';

const INVITABLE_ROLES = ['employee', 'supervisor'] as const;

export default function SiteEmployeesPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = use(params);
  const session = useSession();
  const allowed = manageableRoles(session?.role);
  const inviteRoles: InviteRoleOption[] = INVITABLE_ROLES.filter((role) =>
    allowed.includes(role),
  ).map((role) => ({
    value: role,
    label: ROLE_LABELS[role],
  }));

  return (
    <SiteEmployeesFolderView
      siteId={siteId}
      onInvite={(input) => accessApi.createInvitation(input)}
      inviteRoles={inviteRoles}
    />
  );
}
