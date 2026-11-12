'use client';

import { useState, type FormEvent } from 'react';
import { CheckField, FormFooter, TextField, parseList } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { useAction } from '@/shared/hooks/useAction';
import { organizationApi } from '../api';
import type { Employee, Site } from '../types';

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
  const { run, pending, error } = useAction();

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
    if (result) onSaved();
  };

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
