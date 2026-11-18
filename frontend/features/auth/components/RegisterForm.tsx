'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, startSession } from '@/shared/lib/http';

/** Company registration form: creates the tenant and its owner, then goes to the main screen. */
export function RegisterForm() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      await startSession('/auth/register', { tenantName, name, email, password });
      router.push('/');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'email_taken') {
        setErrorMessage('Ese correo ya está registrado en el sistema.');
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Error inesperado al registrar la empresa.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <div className="auth-brand" aria-hidden="true">
        <i />
        <i />
        TeamWorkFlow
      </div>
      <h2 className="auth-title">
        Crear <u>cuenta</u>
      </h2>
      <p className="auth-sub">Registrá tu empresa y empezá a coordinar tus sedes.</p>
      {errorMessage && (
        <p role="alert" className="auth-error">
          {errorMessage}
        </p>
      )}
      <label htmlFor="register-tenantName" className="auth-label">
        Empresa
      </label>
      <input
        id="register-tenantName"
        type="text"
        required
        autoComplete="organization"
        value={tenantName}
        onChange={(e) => setTenantName(e.target.value)}
        placeholder="Ej. Seguridad Pilar S.A."
        className="auth-input"
      />
      <label htmlFor="register-name" className="auth-label">
        Tu nombre
      </label>
      <input
        id="register-name"
        type="text"
        required
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ej. Angela Álvarez"
        className="auth-input"
      />
      <label htmlFor="register-email" className="auth-label">
        Email
      </label>
      <input
        id="register-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="nombre@empresa.com"
        className="auth-input"
      />
      <label htmlFor="register-password" className="auth-label">
        Contraseña
      </label>
      <input
        id="register-password"
        type="password"
        required
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Mínimo 8 caracteres"
        className="auth-input"
      />
      <button type="submit" disabled={isLoading} className="auth-submit">
        {isLoading ? 'Registrando...' : 'Crear cuenta'}
      </button>
      <p className="auth-trial">14 días de prueba gratis</p>
    </form>
  );
}
