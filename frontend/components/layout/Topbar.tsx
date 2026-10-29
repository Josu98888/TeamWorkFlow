'use client';

import React, { useState, useEffect } from 'react';

export function Topbar() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const isCurrentDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setIsDark(isCurrentDark);
  }, []);

  const toggleTheme = () => {
    const nextTheme = isDark ? 'light' : 'dark';
    if (nextTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    setIsDark(!isDark);
  };

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
      </div>
    </header>
  );
}