'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canAccessRoute } from '@/shared/auth/permissions';
import { useLogout, useSession } from '@/shared/hooks/useSession';
import { useSidebar } from '@/shared/providers/SidebarProvider';

export const SIDEBAR_ID = 'app-sidebar';

export function Sidebar() {
  const pathname = usePathname();
  const session = useSession();

  const logout = useLogout();
  const { isDesktop, isOpen, closeMobile } = useSidebar();
  const drawerOpen = !isDesktop && isOpen;

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMobile();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, closeMobile]);

  const navItems = [
    { label: 'Mi jornada', href: '/mi-jornada' },
    { label: 'Panel Principal', href: '/' },
    { label: 'Torre de Control', href: '/torre-control' },
    { label: 'Sedes y Geocercas', href: '/sedes' },
    { label: 'Tareas y Reportes', href: '/tareas' },
    { label: 'Notificaciones', href: '/notificaciones' },
    { label: 'Empleados', href: '/empleados' },
    { label: 'Turnos', href: '/turnos' },
    { label: 'Asistencia', href: '/asistencia' },
    { label: 'Usuarios', href: '/usuarios' },
    { label: 'Facturación', href: '/facturacion' },
    { label: 'Facturación plataforma', href: '/plataforma/facturacion' },
  ].filter((item) => canAccessRoute(session?.role, item.href));

  return (
    <>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}
    <aside
      id={SIDEBAR_ID}
      inert={!isOpen}
      className={`fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto flex flex-col justify-between p-5 text-white select-none border-r transition-transform lg:static lg:z-auto lg:min-h-screen lg:shrink-0 lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full lg:hidden'
      }`}
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
          <span className="text-sm font-medium capitalize text-white">{session?.role ?? ''}</span>
        </div>
        <button
          onClick={() => void logout()}
          className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-80 cursor-pointer"
          style={{ backgroundColor: 'rgba(180, 35, 50, 0.2)', color: '#FFB4B4' }}
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
    </>
  );
}
