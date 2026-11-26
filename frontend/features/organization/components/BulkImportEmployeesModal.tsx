'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { useAction } from '@/shared/hooks/useAction';
import { organizationApi } from '../api';
import {
  buildSampleEmployeesImportContent,
  parseEmployeesImportFile,
  type ParsedEmployeesFile,
} from '../employees-import-parser';
import type { BulkImportEmployeesResponse, Site } from '../types';

type BulkImportEmployeesModalProps = {
  site: Site;
  onClose: () => void;
  onImported: () => void;
};

export function BulkImportEmployeesModal({
  site,
  onClose,
  onImported,
}: BulkImportEmployeesModalProps) {
  const [parsed, setParsed] = useState<ParsedEmployeesFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [summary, setSummary] = useState<BulkImportEmployeesResponse | null>(null);
  const { run, pending, error } = useAction();

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setSummary(null);
    setParsing(true);
    try {
      const result = await parseEmployeesImportFile(file);
      setParsed(result);
    } catch (err) {
      setParsed(null);
      setParseError(err instanceof Error ? err.message : 'No se pudo leer el archivo seleccionado.');
    } finally {
      setParsing(false);
    }
  };

  const handleDownloadSample = () => {
    const content = buildSampleEmployeesImportContent();
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'plantilla_usuarios_sede.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed || parsed.validItems.length === 0) return;
    const response = await run(() =>
      organizationApi.bulkImportEmployees(site.id, { items: parsed.validItems }),
    );
    if (!response) return;
    setSummary(response);
  };

  if (summary) {
    return (
      <Modal
        title={`Carga finalizada — ${site.name}`}
        onClose={() => {
          onImported();
          onClose();
        }}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">{summary.createdCount} nuevos creados</Badge>
            <Badge tone="info">{summary.updatedCount} actualizados en la sede</Badge>
            {summary.failedCount > 0 && (
              <Badge tone="danger">{summary.failedCount} con observaciones</Badge>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-alt text-[11px] font-semibold text-muted">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">DNI</th>
                  <th className="px-3 py-2">Trabajador</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {summary.results.map((row) => (
                  <tr key={`${row.rowNumber}-${row.email}`}>
                    <td className="px-3 py-2 text-muted">{row.rowNumber}</td>
                    <td className="px-3 py-2 font-mono text-body">{row.nationalId}</td>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-title">{row.fullName}</p>
                      <p className="text-[11px] text-muted">{row.email}</p>
                    </td>
                    <td className="px-3 py-2">
                      {row.status === 'created' ? (
                        <Badge tone="success">Creado</Badge>
                      ) : row.status === 'updated' ? (
                        <Badge tone="info">Vinculado a sede</Badge>
                      ) : (
                        <div className="space-y-0.5">
                          <Badge tone="danger">Error</Badge>
                          {row.detail && <p className="text-[11px] text-danger">{row.detail}</p>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                onImported();
                onClose();
              }}
            >
              Listo
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Cargar Excel de usuarios — ${site.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-line bg-alt p-3 text-xs text-body">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-title">Formato requerido del archivo:</p>
            <Button type="button" variant="ghost" onClick={handleDownloadSample}>
              Descargar plantilla ejemplo
            </Button>
          </div>
          <code className="mt-1.5 block rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-[11px] text-title">
            DNI|NombreApellido|email|contrasena
          </code>
          <p className="mt-1.5 text-[11px] text-muted">
            Acepta archivos Excel (<strong>.xlsx</strong>, en 1 columna separada por{' '}
            <code>|</code> o en 4 columnas) y archivos <strong>.csv / .txt</strong>. Cada usuario
            quedará habilitado automáticamente en <strong>{site.name}</strong> con su cuenta activa.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-subtitle" htmlFor="employees-import-file">
            Seleccionar archivo (.xlsx, .csv o .txt)
          </label>
          <input
            id="employees-import-file"
            type="file"
            accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
            onChange={handleFileChange}
            disabled={pending || parsing}
            className="block w-full cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-xs text-body file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand"
          />
        </div>

        {parsing && <p className="text-xs text-muted">Analizando archivo...</p>}

        {parseError && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {parseError}
          </p>
        )}

        {parsed && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-title">{parsed.fileName}</span>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="success">{parsed.validItems.length} válidas</Badge>
                {parsed.invalidCount > 0 && (
                  <Badge tone="warning">{parsed.invalidCount} inválidas (se omitirán)</Badge>
                )}
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-line bg-alt text-[11px] font-semibold text-muted">
                  <tr>
                    <th className="px-2.5 py-2">Fila</th>
                    <th className="px-2.5 py-2">DNI</th>
                    <th className="px-2.5 py-2">Nombre y apellido</th>
                    <th className="px-2.5 py-2">Email</th>
                    <th className="px-2.5 py-2">Clave</th>
                    <th className="px-2.5 py-2">Validación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {parsed.rows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td className="px-2.5 py-1.5 text-muted">{row.rowNumber}</td>
                      <td className="px-2.5 py-1.5 font-mono text-body">{row.nationalId || '—'}</td>
                      <td className="px-2.5 py-1.5 font-medium text-title">{row.fullName || '—'}</td>
                      <td className="px-2.5 py-1.5 text-muted">{row.email || '—'}</td>
                      <td className="px-2.5 py-1.5 font-mono text-muted">
                        {row.password ? '••••••••' : '—'}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {row.errors.length === 0 ? (
                          <Badge tone="success">OK</Badge>
                        ) : (
                          <span className="text-[11px] text-danger">{row.errors.join(' ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!parsed || parsed.validItems.length === 0 || pending || parsing}
          >
            {pending
              ? 'Importando usuarios...'
              : parsed && parsed.validItems.length > 0
                ? `Importar ${parsed.validItems.length} ${parsed.validItems.length === 1 ? 'usuario' : 'usuarios'}`
                : 'Importar usuarios'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
