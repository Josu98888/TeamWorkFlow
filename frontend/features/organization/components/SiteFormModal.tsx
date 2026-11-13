'use client';

import { useState, type FormEvent } from 'react';
import { CheckField, FormFooter, TextField } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { useAction } from '@/shared/hooks/useAction';
import { organizationApi } from '../api';
import type { Site } from '../types';

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

/** Create (no `site`) or edit a site. */
export function SiteFormModal({ site, onClose, onSaved }: { site?: Site; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(site?.name ?? '');
  const [address, setAddress] = useState(site?.address ?? '');
  const [latitude, setLatitude] = useState(site ? String(site.latitude) : '');
  const [longitude, setLongitude] = useState(site ? String(site.longitude) : '');
  const [radius, setRadius] = useState(site ? String(site.geofenceRadiusMeters) : '150');
  const [timezone, setTimezone] = useState(site?.timezone ?? DEFAULT_TIMEZONE);
  const [isActive, setIsActive] = useState(site?.isActive ?? true);
  const { run, pending, error } = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const values = {
      name: name.trim(),
      address: address.trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      geofenceRadiusMeters: Number(radius),
      timezone: timezone.trim(),
    };
    const result = await run(() =>
      site ? organizationApi.updateSite(site.id, { ...values, isActive }) : organizationApi.createSite(values),
    );
    if (result) onSaved();
  };

  return (
    <Modal title={site ? 'Editar sede' : 'Nueva sede'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <TextField label="Nombre" value={name} onChange={setName} required maxLength={120} />
        <TextField label="Dirección" value={address} onChange={setAddress} required maxLength={300} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Latitud" type="number" step="any" min={-90} max={90} value={latitude} onChange={setLatitude} required />
          <TextField label="Longitud" type="number" step="any" min={-180} max={180} value={longitude} onChange={setLongitude} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Radio de geocerca (m)" type="number" min={1} max={10000} step={1} value={radius} onChange={setRadius} required />
          <TextField label="Zona horaria (IANA)" value={timezone} onChange={setTimezone} required />
        </div>
        {site && <CheckField label="Sede activa" checked={isActive} onChange={setIsActive} />}
        <FormFooter error={error} pending={pending} submitLabel={site ? 'Guardar' : 'Crear sede'} onCancel={onClose} />
      </form>
    </Modal>
  );
}
