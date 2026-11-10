'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Card } from '@/shared/components/Card';
import { FormFooter, TextField } from '@/shared/components/Fields';
import { useAction } from '@/shared/hooks/useAction';

type Failure = { detail?: string; message?: string };

async function submitJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as Failure;
    throw new Error(failure.detail ?? failure.message ?? 'El enlace no es válido o ya venció.');
  }
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-1 text-xl font-bold text-title">{title}</h1>
        {children}
      </Card>
    </main>
  );
}

function MissingToken() {
  return (
    <Shell title="Enlace inválido">
      <p className="text-sm text-muted">Falta el token en el enlace. Pedí uno nuevo a quien administra tu cuenta.</p>
    </Shell>
  );
}

/** Public page body of `/invitations/accept?token=...`: sets name and password, then enters the app. */
export function AcceptInvitationForm({ token }: { token?: string }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { run, pending, error } = useAction();

  if (!token) return <MissingToken />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const done = await run(async () => {
      await submitJson('/api/auth/accept-invitation', { token, name: name.trim(), password });
      return true;
    });
    // The BFF stored the session cookies: go straight to the app.
    if (done) window.location.href = '/';
  };

  return (
    <Shell title="Aceptar invitación">
      <p className="mb-4 text-sm text-muted">Completá tus datos para crear tu cuenta.</p>
      <form onSubmit={submit} className="space-y-3">
        <TextField label="Nombre completo" value={name} onChange={setName} required maxLength={100} />
        <TextField label="Contraseña" type="password" value={password} onChange={setPassword} required minLength={8} maxLength={128} hint="Mínimo 8 caracteres." />
        <FormFooter error={error} pending={pending} submitLabel="Crear cuenta" onCancel={() => setPassword('')} />
      </form>
    </Shell>
  );
}

/** Public page body of `/password-reset?token=...`: sets a new password. */
export function PasswordResetForm({ token }: { token?: string }) {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { run, pending, error } = useAction();

  if (!token) return <MissingToken />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(async () => {
      await submitJson('/api/auth/password-reset-confirm', { token, password });
      return true;
    });
    if (ok) setDone(true);
  };

  if (done) {
    return (
      <Shell title="Contraseña actualizada">
        <p className="mb-4 text-sm text-muted">Ya podés iniciar sesión con tu nueva contraseña.</p>
        <Link href="/login" className="text-sm font-semibold text-link hover:underline">
          Ir a iniciar sesión
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title="Restablecer contraseña">
      <form onSubmit={submit} className="mt-3 space-y-3">
        <TextField label="Nueva contraseña" type="password" value={password} onChange={setPassword} required minLength={8} maxLength={128} hint="Mínimo 8 caracteres." />
        <FormFooter error={error} pending={pending} submitLabel="Cambiar contraseña" onCancel={() => setPassword('')} />
      </form>
    </Shell>
  );
}
