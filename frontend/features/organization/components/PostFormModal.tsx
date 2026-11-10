'use client';

import { useState, type FormEvent } from 'react';
import { CheckField, FormFooter, TextField, parseList } from '@/shared/components/Fields';
import { Modal } from '@/shared/components/Modal';
import { useAction } from '@/shared/hooks/useAction';
import { organizationApi } from '../api';
import type { Post } from '../types';

/** Create (no `post`) or edit a post (puesto) of a site. */
export function PostFormModal({ siteId, post, onClose, onSaved }: { siteId: string; post?: Post; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(post?.name ?? '');
  const [skills, setSkills] = useState(post?.requiredSkills.join(', ') ?? '');
  const [minPeople, setMinPeople] = useState(String(post?.minPeople ?? 1));
  const [isActive, setIsActive] = useState(post?.isActive ?? true);
  const { run, pending, error } = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const values = { name: name.trim(), requiredSkills: parseList(skills), minPeople: Number(minPeople) };
    const result = await run(() =>
      post ? organizationApi.updatePost(post.id, { ...values, isActive }) : organizationApi.createPost(siteId, values),
    );
    if (result) onSaved();
  };

  return (
    <Modal title={post ? 'Editar puesto' : 'Nuevo puesto'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <TextField label="Nombre" value={name} onChange={setName} required maxLength={120} />
        <TextField label="Habilidades requeridas" hint="Separadas por coma" value={skills} onChange={setSkills} />
        <TextField label="Mínimo de personas" type="number" min={1} max={1000} value={minPeople} onChange={setMinPeople} required />
        {post && <CheckField label="Puesto activo" checked={isActive} onChange={setIsActive} />}
        <FormFooter error={error} pending={pending} submitLabel={post ? 'Guardar' : 'Crear puesto'} onCancel={onClose} />
      </form>
    </Modal>
  );
}
