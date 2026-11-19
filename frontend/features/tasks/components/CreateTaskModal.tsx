'use client';

import { useState, type FormEvent } from 'react';
import { organizationApi } from '@/features/organization';
import type { Site } from '@/features/organization/types';
import { FormFooter, SelectField, TextField } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States';
import { useAction } from '@/shared/hooks/useAction';
import { useResource } from '@/shared/hooks/useResource';
import { fullName } from '@/shared/lib/format';
import { tasksApi } from '../api';
import { taskErrorMessage } from '../errors';
import type { FormVersion } from '../types';

/** Latest published version of every form (the list endpoint carries no versions, so each form is read once). */
async function loadLatestVersions(): Promise<FormVersion[]> {
  const { items } = await tasksApi.listForms();
  const forms = await Promise.all(items.map((form) => tasksApi.getForm(form.id)));
  return forms.flatMap((form) => (form.versions?.[0] ? [form.versions[0]] : []));
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Value for `<input type="datetime-local">` (local time, minute precision). */
function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Create a single task from a published form version (owner/admin/supervisor). */
export function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const sites = useResource(organizationApi.listSites);
  const versions = useResource(loadLatestVersions);

  let body;
  if (sites.error || versions.error) {
    body = (
      <ErrorState
        message="No pudimos cargar los datos para crear la tarea."
        onRetry={() => {
          sites.reload();
          versions.reload();
        }}
      />
    );
  } else if (!sites.data || !versions.data) {
    body = <LoadingState rows={1} />;
  } else if (versions.data.length === 0) {
    body = (
      <EmptyState title="No hay formularios publicados" description="Un administrador debe publicar una versión de un formulario antes de crear tareas." />
    );
  } else if (sites.data.items.length === 0) {
    body = <EmptyState title="No hay sedes disponibles" description="Necesitás al menos una sede para asignar la tarea." />;
  } else {
    body = <CreateTaskForm sites={sites.data.items} versions={versions.data} onClose={onClose} onCreated={onCreated} />;
  }

  return (
    <Modal title="Nueva tarea" onClose={onClose}>
      {body}
    </Modal>
  );
}

function CreateTaskForm({
  sites,
  versions,
  onClose,
  onCreated,
}: {
  sites: Site[];
  versions: FormVersion[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [versionId, setVersionId] = useState(versions[0].id);
  const [siteId, setSiteId] = useState(sites[0].id);
  const [postChoice, setPostChoice] = useState('');
  const [employeeChoice, setEmployeeChoice] = useState('');
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState(() => toLocalInput(new Date(Date.now() + 4 * 3_600_000)));
  const [expectedQr, setExpectedQr] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, pending, error } = useAction();

  const posts = useResource(organizationApi.listPosts, siteId);
  const employees = useResource(organizationApi.listEmployees, { siteId, isActive: true, pageSize: 100 });

  const version = versions.find((item) => item.id === versionId) ?? versions[0];
  const activePosts = (posts.data?.items ?? []).filter((post) => post.isActive);
  const postId = activePosts.some((post) => post.id === postChoice) ? postChoice : (activePosts[0]?.id ?? '');
  const employeeOptions = employees.data?.items ?? [];
  const employeeId = employeeOptions.some((employee) => employee.id === employeeChoice) ? employeeChoice : '';
  const hasQrField = version.fields.some((field) => field.type === 'qr');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const deadlineDate = new Date(deadline);
    if (Number.isNaN(deadlineDate.getTime()) || deadlineDate.getTime() <= Date.now()) {
      setLocalError('El vencimiento debe ser una fecha futura.');
      return;
    }
    if (!postId) {
      setLocalError('Elegí un puesto de la sede.');
      return;
    }
    setLocalError(null);
    const qr = expectedQr.trim();
    const result = await run(async () => {
      try {
        return await tasksApi.createTask({
          formVersionId: version.id,
          siteId,
          postId,
          deadline: deadlineDate.toISOString(),
          ...(employeeId ? { employeeId } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(hasQrField && qr ? { expectedQr: qr } : {}),
        });
      } catch (cause) {
        throw new Error(taskErrorMessage(cause, 'No se pudo crear la tarea.'));
      }
    });
    if (result) onCreated();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <SelectField
        label="Formulario"
        value={version.id}
        onChange={setVersionId}
        options={versions.map((item) => ({ value: item.id, label: `${item.name} · versión ${item.version}` }))}
      />
      <TextField label="Título (opcional)" hint="Si lo dejás vacío usamos el nombre del formulario." value={title} onChange={setTitle} maxLength={120} />
      <SelectField label="Sede" value={siteId} onChange={setSiteId} options={sites.map((site) => ({ value: site.id, label: site.name }))} />
      <SelectField
        label="Puesto"
        value={postId}
        onChange={setPostChoice}
        disabled={!posts.data}
        options={activePosts.length ? activePosts.map((post) => ({ value: post.id, label: post.name })) : [{ value: '', label: posts.data ? 'Sin puestos activos' : 'Cargando...' }]}
      />
      <SelectField
        label="Empleado (opcional)"
        hint="Sin empleado, lo puede reclamar quien tenga un turno en curso en ese puesto."
        value={employeeId}
        onChange={setEmployeeChoice}
        options={[
          { value: '', label: 'Sin asignar' },
          ...employeeOptions.map((employee) => ({ value: employee.id, label: fullName(employee) })),
        ]}
      />
      <TextField label="Vence" type="datetime-local" value={deadline} onChange={setDeadline} required />
      {hasQrField && (
        <TextField
          label="Código QR esperado (opcional)"
          hint="El campo QR del formulario deberá coincidir con este valor."
          value={expectedQr}
          onChange={setExpectedQr}
          autoComplete="off"
        />
      )}
      <FormFooter error={localError ?? error} pending={pending} submitLabel="Crear tarea" onCancel={onClose} />
    </form>
  );
}
