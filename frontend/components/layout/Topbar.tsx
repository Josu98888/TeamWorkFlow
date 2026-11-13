'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useLogout, useSession } from '@/shared/hooks/useSession';
import { USE_MOCKS } from '@/shared/lib/config';
import { isDemoSimulating, setDemoRole } from '@/shared/lib/session';

const emptySubscribe = () => () => {};

function getInitialTheme(): boolean {
  if (typeof window === 'undefined') return false;
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return savedTheme === 'dark' || (!savedTheme && systemPrefersDark);
}

export function Topbar() {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const [isDark, setIsDark] = useState(getInitialTheme);
  const session = useSession();
  const logout = useLogout();
  const router = useRouter();

  useEffect(() => {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [isDark]);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    localStorage.setItem('theme', nextDark ? 'dark' : 'light');
  };

  const handleSwitchDemoRole = () => {
    const nextRole = session?.role === 'employee' ? 'owner' : 'employee';
    setDemoRole(nextRole);
    router.push(nextRole === 'employee' ? '/mi-jornada' : '/');
  };

  if (!mounted) {
    return (
      <header
        className="h-16 px-6 flex items-center justify-between border-b"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border-main)',
        }}
      >
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-md"
          style={{ backgroundColor: 'var(--bg-alt)', color: 'var(--text-subtitle)' }}
        >
          Panel de Control
        </span>
      </header>
    );
  }

  const canSimulateEmployee = USE_MOCKS && (!session || session.role === 'owner');
  const isSimulatingEmployee = USE_MOCKS && session?.role === 'employee' && isDemoSimulating();
  const showRoleSwitcher = canSimulateEmployee || isSimulatingEmployee;

  return (
    <header
      className="h-16 px-6 flex items-center justify-between border-b"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: 'var(--border-main)',
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-md"
          style={{
            backgroundColor: 'var(--bg-alt)',
            color: 'var(--text-subtitle)',
          }}
        >
          Panel de Control
        </span>
        {USE_MOCKS && (
          <span
            className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md"
            style={{
              backgroundColor: 'var(--bg-alt)',
              color: 'var(--brand-teal)',
            }}
          >
            Modo Demo
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {session && (
          <span className="hidden sm:inline text-xs mr-1" style={{ color: 'var(--text-subtitle)' }} title={session.userId}>
            <span className="font-semibold capitalize">{session.role}</span> · {session.userId.slice(0, 8)}
          </span>
        )}
{showRoleSwitcher && (
          <>
            <button
              onClick={handleSwitchDemoRole}
              className="inline-flex items-center justify-center gap-2 w-[168px] py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase transition-colors cursor-pointer border"
              style={
                isSimulatingEmployee
                  ? {
                      borderColor: 'var(--brand-dark, #2b1e36)',
                      backgroundColor: 'var(--brand-dark, #2b1e36)',
                      color: '#ffffff',
                    }
                  : {
                      borderColor: 'var(--border-main)',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-body)',
                    }
              }
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: isSimulatingEmployee ? '#ffffff' : 'var(--brand-teal)' }}
              />
              {isSimulatingEmployee ? 'Volver a Admin' : 'Simular Empleado'}
            </button>

            <span className="h-4 w-px" style={{ backgroundColor: 'var(--border-main)' }} aria-hidden="true" />
          </>
        )}

        <button
          onClick={toggleTheme}
          className="inline-flex items-center justify-center w-[122px] py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase transition-colors cursor-pointer border"
          style={{
            borderColor: 'var(--border-main)',
            backgroundColor: 'var(--bg-main)',
            color: 'var(--text-body)',
          }}
        >
          {isDark ? 'Tema Claro' : 'Tema Oscuro'}
        </button>
        
        <button
          onClick={logout}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase transition-colors cursor-pointer border"
          style={{
            borderColor: 'var(--border-main)',
            backgroundColor: 'var(--bg-main)',
            color: 'var(--status-danger)',
          }}
        >
          Salir
        </button>
      </div>
    </header>
  );
}