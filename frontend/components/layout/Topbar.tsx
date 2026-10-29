'use client';

import React, { useState, useEffect } from 'react';

export function Topbar() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
   
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
      document.documentElement.setAttribute('data-theme', 'dark');
      setIsDark(true);
    } else {
      document.documentElement.removeAttribute('data-theme');
      setIsDark(false);
    }
    setMounted(true);
  }, []);

  const toggleTheme = () =>{
    const nextDark = !isDark;
    setIsDark(nextDark);

    if (nextDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
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