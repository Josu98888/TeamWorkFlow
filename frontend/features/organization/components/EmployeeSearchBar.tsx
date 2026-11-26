'use client';

import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { TextField } from '@/shared/components/Fields';
import { Toolbar } from '@/shared/components/List';
import type { Employee } from '../types';

export type EmployeesSearchFilters = {
  siteQuery?: string;
  employeeQuery?: string;
  dniQuery?: string;
};

type SearchLevel = 'root' | 'site';

type EmployeeSearchBarProps = {
  level: SearchLevel;
  filters: EmployeesSearchFilters;
  onChange: (next: EmployeesSearchFilters) => void;
  onClear: () => void;
};

function normalizeSearchToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function matchesSiteSearch(site: { name: string; address: string }, query: string): boolean {
  const clean = normalizeSearchToken(query);
  if (!clean) return true;
  return (
    normalizeSearchToken(site.name).includes(clean) ||
    normalizeSearchToken(site.address).includes(clean)
  );
}

export function matchesWorkerFullName(employee: Employee, query: string): boolean {
  const clean = normalizeSearchToken(query);
  if (!clean) return true;
  const haystack = normalizeSearchToken(
    `${employee.firstName} ${employee.lastName} ${employee.lastName} ${employee.firstName}`,
  );
  return haystack.includes(clean);
}

export function matchesWorkerDni(employee: Employee, dniQuery: string): boolean {
  const clean = dniQuery.trim().replace(/[\s.-]/g, '').toLowerCase();
  if (!clean) return true;
  if (!employee.nationalId) return false;
  return employee.nationalId.trim().replace(/[\s.-]/g, '').toLowerCase().includes(clean);
}

/**
 * Progressive contextual search bar for `/empleados`:
 * - `root`: Sede, Nombre y apellido, DNI (3 filters)
 * - `site`: Nombre y apellido, DNI (2 filters)
 */
export function EmployeeSearchBar({ level, filters, onChange, onClear }: EmployeeSearchBarProps) {
  const columns = level === 'root' ? 3 : 2;
  const hasFilters = Boolean(
    (level === 'root' && filters.siteQuery?.trim()) ||
      filters.employeeQuery?.trim() ||
      filters.dniQuery?.trim(),
  );

  return (
    <Card flush className="px-4 py-3">
      <Toolbar columns={columns}>
        {level === 'root' && (
          <TextField
            label="Sede"
            placeholder="Buscar por sede o dirección..."
            value={filters.siteQuery ?? ''}
            onChange={(value) => onChange({ ...filters, siteQuery: value })}
          />
        )}
        <TextField
          label="Nombre y apellido"
          placeholder="Buscar por nombre o apellido..."
          value={filters.employeeQuery ?? ''}
          onChange={(value) => onChange({ ...filters, employeeQuery: value })}
        />
        <TextField
          label="DNI"
          placeholder="Número de DNI..."
          value={filters.dniQuery ?? ''}
          onChange={(value) => onChange({ ...filters, dniQuery: value })}
        />
      </Toolbar>
      {hasFilters && (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" onClick={onClear}>
            Limpiar filtros
          </Button>
        </div>
      )}
    </Card>
  );
}
