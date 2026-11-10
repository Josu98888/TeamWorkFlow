'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/components/Button';
import { CheckField, FormFooter, SelectField } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { useAction } from '@/shared/hooks/useAction';
import { organizationApi } from '@/features/organization';
import { useResource } from '@/shared/hooks/useResource';
import { useSession } from '@/shared/hooks/useSession';
import { manageableRoles } from '@/shared/auth/permissions';
import { accessApi } from '../api';
import { ROLE_LABELS } from '../labels';
import { ASSIGNABLE_ROLES, type AssignableRole, type CreatedPasswordReset } from '../types';
import { LinkModal } from './LinkModal';

type Dialog = 'role' | 'sites' | null;

/** Account actions available in core for one user id: role, sites, deactivate, password-reset link. */
export function UserActions({ userId }: { userId: string }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reset, setReset] = useState<CreatedPasswordReset | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();

  const deactivate = async () => {
    if (!window.confirm('¿Desactivar esta cuenta? No podrá volver a iniciar sesión.')) return;
    if (await action.run(() => accessApi.deactivateUser(userId))) setNotice('Cuenta desactivada.');
  };

  const createReset = async () => {
    const result = await action.run(() => accessApi.createPasswordReset(userId));
    if (result) setReset(result);
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" onClick={() => setDialog('role')}>Rol</Button>
      <Button variant="ghost" onClick={() => setDialog('sites')}>Sedes</Button>
      <Button variant="ghost" onClick={createReset} disabled={action.pending}>Enlace de contraseña</Button>
      <Button variant="ghost" onClick={deactivate} disabled={action.pending}>Desactivar</Button>
      {notice && <span className="text-xs text-muted">{notice}</span>}
      {action.error && (
        <span role="alert" className="text-xs text-danger">
          {action.error}
        </span>
      )}
      {dialog === 'role' && <RoleModal userId={userId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setNotice('Rol actualizado.'); }} />}
      {dialog === 'sites' && <SitesModal userId={userId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setNotice('Sedes actualizadas.'); }} />}
      {reset && <LinkModal title="Enlace de restablecimiento" path="/password-reset" token={reset.token} expiresAt={reset.expiresAt} onClose={() => setReset(null)} />}
    </div>
  );
}

function RoleModal({ userId, onClose, onDone }: { userId: string; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<AssignableRole>('supervisor');
  const { run, pending, error } = useAction();
  const allowedRoles = manageableRoles(useSession()?.role);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => accessApi.changeUserRole(userId, role))) onDone();
  };

  return (
    <Modal title="Cambiar rol" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <SelectField label="Nuevo rol" value={role} onChange={(value) => setRole(value as AssignableRole)} options={ASSIGNABLE_ROLES.filter((value) => allowedRoles.includes(value)).map((value) => ({ value, label: ROLE_LABELS[value] }))} />
        <FormFooter error={error} pending={pending} submitLabel="Cambiar rol" onCancel={onClose} />
      </form>
    </Modal>
  );
}

function SitesModal({ userId, onClose, onDone }: { userId: string; onClose: () => void; onDone: () => void }) {
  const sites = useResource(organizationApi.listSites);
  const [selected, setSelected] = useState<string[]>([]);
  const { run, pending, error } = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => accessApi.assignUserSites(userId, selected))) onDone();
  };

  return (
    <Modal title="Asignar sedes" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-muted">Reemplaza el conjunto completo de sedes del usuario. Sin marcar ninguna, se quitan todas.</p>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
          {sites.data?.items.map((site) => (
            <CheckField
              key={site.id}
              label={site.name}
              checked={selected.includes(site.id)}
              onChange={(checked) => setSelected((current) => (checked ? [...current, site.id] : current.filter((id) => id !== site.id)))}
            />
          )) ?? <p className="text-xs text-muted">Cargando sedes...</p>}
        </div>
        <FormFooter error={error} pending={pending} submitLabel="Guardar sedes" onCancel={onClose} />
      </form>
    </Modal>
  );
}
