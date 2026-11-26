'use client';

import Link from 'next/link';

type EmployeeFolderBreadcrumbsProps = {
  site?: { id: string; name: string };
};

/** Breadcrumb path matching the 2-level Empleados folder hierarchy (`Empleados (Sedes) > Sede`). */
export function EmployeeFolderBreadcrumbs({ site }: EmployeeFolderBreadcrumbsProps) {
  return (
    <nav aria-label="Ruta de carpetas de empleados" className="flex flex-wrap items-center gap-2 text-xs">
      {site ? (
        <Link href="/empleados" className="font-semibold text-link hover:underline">
          Empleados (Sedes)
        </Link>
      ) : (
        <span className="font-semibold text-title">Empleados (Sedes)</span>
      )}

      {site && (
        <>
          <span aria-hidden className="text-muted">
            /
          </span>
          <span className="font-semibold text-title">{site.name}</span>
        </>
      )}
    </nav>
  );
}
