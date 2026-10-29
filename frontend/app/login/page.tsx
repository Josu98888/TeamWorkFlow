'use client';

import React, { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Demasiados intentos fallidos. Tu cuenta fue bloqueada temporalmente por 15 minutos.');
        }

        if (data.code === 'tenant_suspended' || data.message === 'tenant_suspended') {
          throw new Error('La empresa se encuentra suspendida por mora.');
        }

        if (data.code === 'tenant_cancelled' || data.message === 'tenant_cancelled') {
          throw new Error('La suscripción de la empresa fue cancelada.');
        }

        throw new Error(data.detail || data.message || 'Credenciales inválidas. Verificá tu correo y contraseña.');
      }

      // Guardamos el token en localStorage para las llamadas protegidas
      if (data.accessToken) {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
      }

      // Redirigir a la pantalla principal
      window.location.href = '/';
    } catch (err: unknown) {
      if (err instanceof Error) {
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