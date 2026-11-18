'use client';

import { useState, type FormEvent } from 'react';
import { accessApi, ROLE_LABELS } from '@/features/access';
import { Button } from '@/shared/components/Button';
import { CheckField, FormFooter, SelectField, TextField, parseList } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { manageableRoles } from '@/shared/auth/permissions';
import { useAction } from '@/shared/hooks/useAction';
import { useSession } from '@/shared/hooks/useSession';
import { organizationApi } from '../api';
import type { Employee, Site } from '../types';

// Access levels offered on creation; '' means the employee gets no account yet.
const ACCESS_ROLES = ['employee', 'supervisor'] as const;
type AccessChoice = '' | (typeof ACCESS_ROLES)[number];

const orNull = (text: string) => (text.trim() ? text.trim() : null);

/** Create (no `employee`) or edit an employee. The email is only set on creation. */
export function EmployeeFormModal({
  employee,
  sites,
  onClose,
  onSaved,
}: {
  employee?: Employee;
  sites: Site[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(employee?.firstName ?? '');
  const [lastName, setLastName] = useState(employee?.lastName ?? '');
  const [email, setEmail] = useState(employee?.email ?? '');
  const [phone, setPhone] = useState(employee?.phone ?? '');
  const [employeeNumber, setEmployeeNumber] = useState(employee?.employeeNumber ?? '');
  const [nationalId, setNationalId] = useState(employee?.nationalId ?? '');
  const [skills, setSkills] = useState(employee?.skills.join(', ') ?? '');
  const [weeklyHours, setWeeklyHours] = useState(employee?.weeklyHoursLimit ? String(employee.weeklyHoursLimit) : '');
  const [siteIds, setSiteIds] = useState<string[]>(employee?.siteIds ?? []);
  const [isActive, setIsActive] = useState(employee?.isActive ?? true);
  const [access, setAccess] = useState<AccessChoice>('');
  // Set when the profile was created but the follow-up invitation failed.
  const [inviteFailed, setInviteFailed] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const session = useSession();
  const allowedRoles = manageableRoles(session?.role);
  const accessOptions = ACCESS_ROLES.filter((role) => allowedRoles.includes(role));
  const hasEmail = email.trim() !== '';

  const toggleSite = (id: string, checked: boolean) =>
    setSiteIds((current) => (checked ? [...current, id] : current.filter((item) => item !== id)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const values = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: orNull(phone),
      employeeNumber: orNull(employeeNumber),
      nationalId: orNull(nationalId),
      skills: parseList(skills),
      weeklyHoursLimit: weeklyHours ? Number(weeklyHours) : null,
      siteIds,
    };
    const result = await run(() =>
      employee
        ? organizationApi.updateEmployee(employee.id, { ...values, isActive })
        : organizationApi.createEmployee({ ...values, email: email.trim() }),
    );
    if (!result) return;
    if (!employee && access && hasEmail) {
      try {
        await accessApi.createInvitation({ email: email.trim(), role: access });
      } catch {
        // The profile exists: keep it and tell the user how to send the invitation.
        setInviteFailed(`Se creó el perfil de ${firstName.trim()} ${lastName.trim()}, pero no se pudo enviar la invitación. Podés enviarla desde Usuarios.`);
        return;
      }
    }
    onSaved();
  };

  if (inviteFailed) {
    return (
      <Modal title="Nuevo empleado" onClose={onSaved}>
        <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {inviteFailed}
        </p>
        <Button variant="primary" onClick={onSaved}>
          Cerrar
        </Button>
      </Modal>
    );
  }

  return (
    <Modal title={employee ? 'Editar empleado' : 'Nuevo empleado'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Nombre" value={firstName} onChange={setFirstName} required maxLength={100} />
          <TextField label="Apellido" value={lastName} onChange={setLastName} required maxLength={100} />
        </div>
        <TextField
          label="Correo electrónico"
          type="email"
          value={email}
          onChange={setEmail}
          required
          disabled={!!employee}
          hint={employee ? 'No editable: el usuario se vincula por correo.' : undefined}
        />
        {!employee && (
          <SelectField
            label="Acceso"
            hint={hasEmail ? 'Opcional: envía una invitación para que la persona cree su cuenta.' : 'Ingresá un correo para poder invitar.'}
            value={access}
            onChange={(value) => setAccess(value as AccessChoice)}
            disabled={!hasEmail || accessOptions.length === 0}
            options={[{ value: '', label: 'Sin cuenta' }, ...accessOptions.map((role) => ({ value: role, label: ROLE_LABELS[role] }))]}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Teléfono" value={phone} onChange={setPhone} maxLength={40} />
          <TextField label="Legajo" value={employeeNumber} onChange={setEmployeeNumber} maxLength={40} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Documento" value={nationalId} onChange={setNationalId} maxLength={40} />
          <TextField label="Límite semanal (h)" type="number" min={1} max={168} value={weeklyHours} onChange={setWeeklyHours} />
        </div>
        <TextField label="Habilidades" hint="Separadas por coma" value={skills} onChange={setSkills} />
        <fieldset>
          <legend className="mb-1 text-xs font-semibold text-subtitle">Sedes habilitadas</legend>
          <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {sites.map((site) => (
              <CheckField key={site.id} label={site.name} checked={siteIds.includes(site.id)} onChange={(checked) => toggleSite(site.id, checked)} />
            ))}
          </div>
        </fieldset>
        {employee && <CheckField label="Empleado activo" checked={isActive} onChange={setIsActive} />}
        <FormFooter error={error} pending={pending} submitLabel={employee ? 'Guardar' : 'Crear empleado'} onCancel={onClose} />
      </form>
    </Modal>
  );
}
