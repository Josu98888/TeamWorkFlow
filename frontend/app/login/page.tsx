'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, startSession } from '../../shared/lib/http';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      await startSession('/auth/login', { email, password });

      // Redirigir a la pantalla principal
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
    <main
      className="flex min-h-screen items-center justify-center p-4"
      style={{ backgroundColor: 'var(--bg-main)' }}
    >
      <div
        className="w-full max-w-md rounded-xl p-8 shadow-sm"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-main)',
        }}
      >
        <div className="mb-6 text-center">
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: 'var(--text-title)' }}
          >
            WORKFLOW
          </h1>
          <p
            className="text-xs font-medium tracking-wide mt-1"
            style={{ color: 'var(--brand-teal)' }}
          >
            Gestioná. Supervisá. Operá.
          </p>
        </div>

        {errorMessage && (
          <div
            className="mb-5 rounded-lg p-3 text-sm flex items-start gap-2"
            style={{
              backgroundColor: 'rgba(180, 35, 50, 0.1)',
              color: 'var(--status-danger)',
              border: '1px solid rgba(180, 35, 50, 0.2)',
            }}
          >
            <span></span>
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-semibold mb-1"
              style={{ color: 'var(--text-subtitle)' }}
            >
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@empresa.com"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: 'var(--bg-main)',
                border: '1px solid var(--border-main)',
                color: 'var(--text-body)',
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-semibold mb-1"
              style={{ color: 'var(--text-subtitle)' }}
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: 'var(--bg-main)',
                border: '1px solid var(--border-main)',
                color: 'var(--text-body)',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity mt-2 cursor-pointer"
            style={{
              backgroundColor: 'var(--brand-primary)',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? 'Iniciando sesión...' : 'Ingresar'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <a
            href="/register"
            className="text-xs hover:underline"
            style={{ color: 'var(--brand-primary)' }}
          >
            ¿No tenés cuenta? Registrá tu empresa
          </a>
        </div>
      </div>
    </main>
  );
}
