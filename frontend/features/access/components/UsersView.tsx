'use client';

import { useState, type FormEvent } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { FormFooter, SelectField, TextField } from '@/shared/components/Fields';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { useSession } from '@/shared/hooks/useSession';
import { manageableRoles } from '@/shared/auth/permissions';
import { formatDateTime, fullName } from '@/shared/lib/format';
import { organizationApi } from '@/features/organization';
import { accessApi } from '../api';
import { ROLE_LABELS } from '../labels';
import { ASSIGNABLE_ROLES, type AssignableRole, type CreatedInvitation } from '../types';
import { LinkModal } from './LinkModal';
import { UserActions } from './UserActions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function UsersView() {
  const invitations = useResource(accessApi.listInvitations);
  const employees = useResource(organizationApi.listEmployees, { pageSize: 100 });
  const session = useSession();
  // Roles this actor may invite/regenerate (owner: admin+supervisor+employee; admin: supervisor+employee).
  const allowedRoles = manageableRoles(session?.role);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('employee');
  const [manualId, setManualId] = useState('');
  const create = useAction();
  const regenerate = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await create.run(() => accessApi.createInvitation({ email: email.trim(), role }));
    if (result) {
      setCreated(result);
      setEmail('');
      invitations.reload();
    }
  };

  const regenerateInvitation = async (invitationId: string) => {
    const result = await regenerate.run(() => accessApi.regenerateInvitation(invitationId));
    if (result) {
      setCreated(result);
      invitations.reload();
    }
  };

  const withAccount = (employees.data?.items ?? []).filter((employee) => employee.userId);

  return (
    <>
      <PageHeader title="Usuarios" description="Invitaciones y administración de cuentas de acceso." />
      {created && <LinkModal title="Enlace de invitación" path="/invitations/accept" token={created.token} expiresAt={created.expiresAt} onClose={() => setCreated(null)} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <SectionLabel>Invitar usuario</SectionLabel>
          <form onSubmit={submit} className="space-y-3">
            <TextField label="Correo electrónico" type="email" value={email} onChange={setEmail} required />
            <SelectField label="Rol" value={role} onChange={(value) => setRole(value as AssignableRole)} options={ASSIGNABLE_ROLES.filter((value) => allowedRoles.includes(value)).map((value) => ({ value, label: ROLE_LABELS[value] }))} />
            <FormFooter error={create.error} pending={create.pending} submitLabel="Crear invitación" onCancel={() => setEmail('')} />
          </form>
        </Card>

        <Card flush className="lg:col-span-2">
          <div className="px-5 pt-5">
            <SectionLabel>Invitaciones pendientes</SectionLabel>
          </div>
          {invitations.error ? (
            <div className="p-5"><ErrorState message="No pudimos cargar las invitaciones." onRetry={invitations.reload} /></div>
          ) : !invitations.data ? (
            <div className="p-5"><LoadingState rows={1} /></div>
          ) : invitations.data.length === 0 ? (
            <div className="px-5 pb-5"><EmptyState title="No hay invitaciones pendientes" /></div>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {invitations.data.map((invitation) => (
                <li key={invitation.invitationId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-title">{invitation.email}</p>
                    <p className="text-xs text-muted">Vence {formatDateTime(invitation.expiresAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="info">{ROLE_LABELS[invitation.role]}</Badge>
                    <Button
                      onClick={() => regenerateInvitation(invitation.invitationId)}
                      disabled={regenerate.pending || !allowedRoles.includes(invitation.role)}
                      title={allowedRoles.includes(invitation.role) ? undefined : 'Solo el propietario gestiona invitaciones de administradores.'}
                    >
                      Regenerar enlace
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {regenerate.error && <p role="alert" className="px-5 pb-4 text-xs text-danger">{regenerate.error}</p>}
        </Card>
      </div>

      <Card flush className="mt-4">
        <div className="px-5 pt-5">
          <SectionLabel>Cuentas vinculadas a empleados</SectionLabel>
          <p className="-mt-2 mb-3 text-xs text-muted">
            El backend no ofrece un listado de usuarios: se muestran los empleados que ya tienen cuenta (userId).
          </p>
        </div>
        {employees.error ? (
          <div className="p-5"><ErrorState message="No pudimos cargar los empleados." onRetry={employees.reload} /></div>
        ) : !employees.data ? (
          <div className="p-5"><LoadingState rows={1} /></div>
        ) : withAccount.length === 0 ? (
          <div className="px-5 pb-5"><EmptyState title="Ningún empleado tiene cuenta todavía" description="Invitá a un usuario con el mismo correo del empleado." /></div>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {withAccount.map((employee) => (
              <li key={employee.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-title">{fullName(employee)}</p>
                  <p className="truncate text-xs text-muted">{employee.email}</p>
                </div>
                {employee.userId && <UserActions userId={employee.userId} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-4">
        <SectionLabel>Acciones por ID de usuario</SectionLabel>
        <p className="mb-3 text-xs text-muted">Para cuentas sin empleado asociado (por ejemplo administradores).</p>
        <div className="max-w-xl">
          <TextField label="ID de usuario (UUID)" value={manualId} onChange={setManualId} placeholder="00000000-0000-0000-0000-000000000000" />
        </div>
        {UUID.test(manualId.trim()) && (
          <div className="mt-3">
            <UserActions key={manualId.trim()} userId={manualId.trim()} />
          </div>
        )}
      </Card>
    </>
  );
}
