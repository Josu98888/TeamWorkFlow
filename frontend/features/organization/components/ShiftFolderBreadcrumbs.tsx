'use client';

import Link from 'next/link';

type ShiftFolderBreadcrumbsProps = {
  site?: { id: string; name: string };
  post?: { id: string; name: string };
};

function ChevronSeparator() {
  return (
    <span aria-hidden className="text-muted">
      /
    </span>
  );
}

/** Breadcrumb path matching the 3-level Turnos folder hierarchy (Turnos > Sede > Puesto). */
export function ShiftFolderBreadcrumbs({ site, post }: ShiftFolderBreadcrumbsProps) {
  return (
    <nav aria-label="Ruta de carpetas de turnos" className="flex flex-wrap items-center gap-2 text-xs">
      {site ? (
        <Link href="/turnos" className="font-semibold text-link hover:underline">
          Turnos (Sedes)
        </Link>
      ) : (
        <span className="font-semibold text-title">Turnos (Sedes)</span>
      )}

      {site && (
        <>
          <ChevronSeparator />
          {post ? (
            <Link href={`/turnos/${site.id}`} className="font-semibold text-link hover:underline">
              {site.name}
            </Link>
          ) : (
            <span className="font-semibold text-title">{site.name}</span>
          )}
        </>
      )}

      {site && post && (
        <>
          <ChevronSeparator />
          <span className="font-semibold text-title">{post.name}</span>
        </>
      )}
    </nav>
  );
}
