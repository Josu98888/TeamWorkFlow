'use client';

import { Can } from '@/shared/hooks/useCan';
import { useState } from 'react';
import { Avatar } from '@/shared/components/Avatar';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { SelectField, TextField } from '@/shared/components/Fields';
import { ListRow, RowList, Toolbar } from '@/shared/components/List';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useResource } from '@/shared/hooks/useResource';
import { fullName, initials } from '@/shared/lib/format';
import { organizationApi } from '../api';
import type { Employee, InviteEmployee, InviteRoleOption, ListEmployeesQuery } from '../types';
import { EmployeeFormModal } from './EmployeeFormModal';

const ACTIVE_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'true', label: 'Activos' },
  { value: 'false', label: 'Inactivos' },
] as const;

export function EmployeesView({ onInvite, inviteRoles }: { onInvite?: InviteEmployee; inviteRoles?: readonly InviteRoleOption[] } = {}) {
  const [search, setSearch] = useState('');
  const [siteId, setSiteId] = useState('');
  const [active, setActive] = useState('');
  // `null` = closed, `'new'` = create, an employee = edit.
  const [form, setForm] = useState<Employee | 'new' | null>(null);

  const query: ListEmployeesQuery = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(siteId ? { siteId } : {}),
    ...(active ? { isActive: active === 'true' } : {}),
    pageSize: 100,
  };
  const employees = useResource(organizationApi.listEmployees, query);
  const sites = useResource(organizationApi.listSites);
  const siteName = new Map((sites.data?.items ?? []).map((site) => [site.id, site.name]));

  const header = (
    <PageHeader
      title="Empleados"
      description="Personal, habilidades y sedes habilitadas."
      actions={
        <Can capability="employees.manage">
          <Button variant="primary" onClick={() => setForm('new')} disabled={!sites.data}>
            Nuevo empleado
          </Button>
        </Can>
      }
    />
  );

  return (
    <>
      {header}
      {form && sites.data && (
        <EmployeeFormModal
          employee={form === 'new' ? undefined : form}
          sites={sites.data.items}
          onInvite={onInvite}
          inviteRoles={inviteRoles}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            employees.reload();
          }}
        />
      )}

      <Toolbar>
        <TextField label="Buscar" placeholder="Nombre, apellido o correo" value={search} onChange={setSearch} />
        <SelectField
          label="Sede"
          value={siteId}
          onChange={setSiteId}
          options={[{ value: '', label: 'Todas' }, ...(sites.data?.items ?? []).map((site) => ({ value: site.id, label: site.name }))]}
        />
        <SelectField label="Estado" value={active} onChange={setActive} options={ACTIVE_OPTIONS} />
      </Toolbar>

      {employees.error ? (
        <ErrorState message="No pudimos cargar los empleados." onRetry={employees.reload} />
      ) : !employees.data ? (
        <LoadingState rows={2} />
      ) : employees.data.items.length === 0 ? (
        <EmptyState title="No encontramos empleados" description="Probá con otros filtros o creá uno nuevo." />
      ) : (
        <Card flush glow="none">
          <RowList>
            {employees.data.items.map((employee) => (
              <ListRow
                key={employee.id}
                leading={<Avatar initials={initials(employee)} label={fullName(employee)} />}
                trailing={
                  <>
                    {!employee.isActive && <Badge>Inactivo</Badge>}
                    <Can capability="employees.manage">
                      <Button variant="ghost" onClick={() => setForm(employee)}>
                        Editar
                      </Button>
                    </Can>
                  </>
                }
              >
                <div>
                  <p className="truncate text-sm font-semibold text-title">{fullName(employee)}</p>
                  <p className="truncate text-xs text-muted">
                    {employee.email}
                    {employee.skills.length > 0 && ` · ${employee.skills.join(', ')}`}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {employee.siteIds.map((id) => siteName.get(id) ?? 'Sede').join(' · ') || 'Sin sedes habilitadas'}
                  </p>
                </div>
              </ListRow>
            ))}
          </RowList>
        </Card>
      )}
    </>
  );
}
