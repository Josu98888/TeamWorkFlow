'use client';

import { AuthCard, AuthShell } from '@/features/auth';
import { useLogout } from '@/shared/hooks/useSession';

export default function NoAccessPage() {
  const logout = useLogout();
  return (
    <AuthShell>
      <AuthCard>
        <h1 className="mb-1 text-xl font-bold text-title">Sin acceso</h1>
        <p className="text-sm text-muted">Tu cuenta no tiene permisos para usar esta aplicación. Contactá a tu administrador.</p>
        <button type="button" onClick={logout} className="auth-submit mt-6">
          Cerrar sesión
        </button>
      </AuthCard>
    </AuthShell>
  );
}
