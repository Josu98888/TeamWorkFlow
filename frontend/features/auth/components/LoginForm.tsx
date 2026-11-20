'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, startSession } from '@/shared/lib/http';

/** Login form: signs in and goes to the main screen. */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      await startSession('/auth/login', { email, password });
      router.push('/');
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setErrorMessage('Demasiados intentos fallidos. Tu cuenta fue bloqueada temporalmente por 15 minutos.');
        } else if (err.code === 'tenant_suspended') {
          setErrorMessage('La empresa se encuentra suspendida por mora.');
        } else if (err.code === 'tenant_cancelled') {
          setErrorMessage('La suscripción de la empresa fue cancelada.');
        } else {
          setErrorMessage(err.status === 401 ? 'Credenciales inválidas. Verificá tu correo y contraseña.' : err.message);
        }
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Ocurrió un error inesperado al iniciar sesión.');
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
      <h1 className="auth-title">
        Iniciar <u>sesión</u>
      </h1>
      <p className="auth-sub">Ingresá con tu correo y contraseña.</p>
      {errorMessage && (
        <p role="alert" className="auth-error">
          {errorMessage}
        </p>
      )}
      <label htmlFor="login-email" className="auth-label">
        Email
      </label>
      <input
        id="login-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="nombre@empresa.com"
        className="auth-input"
      />
      <label htmlFor="login-password" className="auth-label">
        Contraseña
      </label>
      <input
        id="login-password"
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        className="auth-input"
      />
      <Link href="/password-reset" className="auth-forgot">
        ¿Olvidaste tu contraseña?
      </Link>
      <button type="submit" disabled={isLoading} className="auth-submit">
        {isLoading ? 'Iniciando sesión...' : 'Ingresar'}
      </button>
    </form>
  );
}
