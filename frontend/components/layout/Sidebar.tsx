'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Sidebar({ userRole = 'owner' }: { userRole?: string }) {
  const pathname = usePathname();

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    window.location.href = '/login';
  };

  const navItems = [
    { label: 'Panel Principal', href: '/' },
    { label: 'Torre de Control', href: '/torre-control' },
    { label: 'Sedes y Geocercas', href: '/sedes' },
    { label: 'Tareas y Reportes', href: '/tareas' },
  ];

  return (
    <aside
      className="w-64 flex flex-col justify-between p-5 min-h-screen text-white select-none border-r"
      style={{
        backgroundColor: 'var(--bg-sidebar)',
        borderColor: 'rgba(255, 255, 255, 0.08)',
      }}
    >
      <div>
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-white">WORKFLOW</h2>
          <p className="text-xs font-medium tracking-wide mt-1 uppercase" style={{ color: 'var(--brand-mint)' }}>
            Gestión Operativa
          </p>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: isActive ? 'var(--bg-hover)' : 'transparent',
                  color: isActive ? 'var(--brand-dark)' : '#FFFFFF',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="pt-4 border-t" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
        <div className="mb-3 px-1">
          <span className="block text-[11px] uppercase tracking-wider text-gray-400">Rol activo</span>
          <span className="text-sm font-medium capitalize text-white">{userRole}</span>
        </div>
        <button
          onClick={handleLogout}
          className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-80 cursor-pointer"
          style={{ backgroundColor: 'rgba(180, 35, 50, 0.2)', color: '#FFB4B4' }}
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}