'use client';

import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { TextField } from '@/shared/components/Fields';
import { Toolbar } from '@/shared/components/List';
import type { TurnosSearchFilters } from '../turnos-utils';

type SearchLevel = 'root' | 'site' | 'post';

type ShiftSearchBarProps = {
  level: SearchLevel;
  filters: TurnosSearchFilters;
  onChange: (next: TurnosSearchFilters) => void;
  onClear: () => void;
};

/**
 * Progressive contextual search bar for `/turnos`:
 * - `root`: Sede, Puesto de Trabajo, Empleado, DNI (4 filters)
 * - `site`: Puesto de Trabajo, Empleado, DNI (3 filters)
 * - `post`: Nombre de Empleado, DNI (2 filters)
 */
export function ShiftSearchBar({ level, filters, onChange, onClear }: ShiftSearchBarProps) {
  const columns = level === 'root' ? 4 : level === 'site' ? 3 : 2;
  const hasFilters = Boolean(
    (level === 'root' && filters.siteQuery?.trim()) ||
      (level !== 'post' && filters.postQuery?.trim()) ||
      filters.employeeQuery?.trim() ||
      filters.dniQuery?.trim(),
  );

  return (
    <Card flush className="px-4 py-3">
      <Toolbar columns={columns}>
        {level === 'root' && (
          <TextField
            label="Sede"
            placeholder="Buscar sede..."
            value={filters.siteQuery ?? ''}
            onChange={(value) => onChange({ ...filters, siteQuery: value })}
          />
        )}
        {level !== 'post' && (
          <TextField
            label="Puesto de trabajo"
            placeholder="Buscar puesto..."
            value={filters.postQuery ?? ''}
            onChange={(value) => onChange({ ...filters, postQuery: value })}
          />
        )}
        <TextField
          label={level === 'post' ? 'Nombre de empleado' : 'Empleado'}
          placeholder="Nombre o apellido..."
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
