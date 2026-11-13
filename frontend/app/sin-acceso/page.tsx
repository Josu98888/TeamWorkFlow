'use client';

import { useLogout } from '@/shared/hooks/useSession';

export default function NoAccessPage() {
  const logout = useLogout();
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-bold text-body">Sin acceso</h1>
        <p className="mt-2 text-sm text-muted">Tu cuenta no tiene permisos para usar esta aplicación. Contactá a tu administrador.</p>
        <button
          type="button"
          onClick={logout}
          className="mt-4 cursor-pointer rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          Cerrar sesión
        </button>
      </div>
    </main>
  );
}
