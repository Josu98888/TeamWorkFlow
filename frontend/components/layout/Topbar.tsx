'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useLogout, useSession } from '@/shared/hooks/useSession';

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

  return (
    <header
      className="h-16 px-6 flex items-center justify-between border-b"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: 'var(--border-main)',
      }}
    >
      <div>
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-md"
          style={{
            backgroundColor: 'var(--bg-alt)',
            color: 'var(--text-subtitle)',
          }}
        >
          Panel de Control
        </span>
      </div>

      <div className="flex items-center gap-4">
        {session && (
          <span className="text-xs" style={{ color: 'var(--text-subtitle)' }} title={session.userId}>
            <span className="font-semibold capitalize">{session.role}</span> · {session.userId.slice(0, 8)}
          </span>
        )}
        <button
          onClick={toggleTheme}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase transition-colors cursor-pointer border"
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
          className="px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase cursor-pointer border"
          style={{ borderColor: 'var(--border-main)', backgroundColor: 'var(--bg-main)', color: 'var(--status-danger)' }}
        >
          Salir
        </button>
      </div>
    </header>
  );
}