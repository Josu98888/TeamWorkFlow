'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUnreadCount } from '@/features/notifications';
import { canAccessRoute } from '@/shared/auth/permissions';
import { useLogout, useSession } from '@/shared/hooks/useSession';
import { useSidebar } from '@/shared/providers/SidebarProvider';
import { SidebarIcon } from './SidebarIcons';
import { NAV_SECTIONS } from './sidebar-nav';
import './sidebar.css';

export const SIDEBAR_ID = 'app-sidebar';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  supervisor: 'Supervisor',
  employee: 'Empleado',
  platform_admin: 'Admin de plataforma',
};

/** Lowercase, accent-free text so the menu filter ignores case and diacritics. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function initialsOf(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((word) => word[0]) : [...text].slice(0, 2);
  return letters.join('').toUpperCase();
}

export function Sidebar() {
  const pathname = usePathname();
  const session = useSession();
  const logout = useLogout();
  const { mode, isOpen, isOverlay, toggle, close } = useSidebar();
  const { count: unread } = useUnreadCount();
  const [query, setQuery] = useState('');

  // Rail: icons only. Tablet is always a rail until the overlay expands it; mobile has no rail.
  const rail = mode !== 'mobile' && !isOpen;
  // The active item fuses with the content card only in the full desktop sidebar.
  const merged = mode === 'desktop' && isOpen;
  const hidden = mode === 'mobile' && !isOpen;
  const term = normalize(isOpen ? query.trim() : '');

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => canAccessRoute(session?.role, item.href) && (!term || normalize(item.label).includes(term)),
    ),
  })).filter((section) => section.items.length > 0);

  const roleLabel = session ? (ROLE_LABELS[session.role] ?? session.role) : '';

  return (
    <>
      {isOverlay && <div className="sb-scrim" onClick={close} aria-hidden="true" />}
      <div className="sb-slot" data-mode={mode} data-rail={rail}>
        <aside
          id={SIDEBAR_ID}
          aria-label="Menú lateral"
          inert={hidden}
          className="sb"
          data-mode={mode}
          data-rail={rail}
          data-merged={merged}
          data-overlay={isOverlay}
        >
          <div className="sb-head">
            <span className="sb-logo" aria-hidden="true">
              <i />
              <i />
            </span>
            <div className="sb-brand">
              <strong>TeamWorkFlow</strong>
              <small>Gestión operativa</small>
            </div>
          </div>

          {rail ? (
            <button type="button" className="sb-search" onClick={toggle} aria-label="Buscar en el menú" title="Buscar en el menú">
              <SidebarIcon name="search" />
            </button>
          ) : (
            <label className="sb-search">
              <SidebarIcon name="search" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar en el menú"
                aria-label="Buscar en el menú"
                autoComplete="off"
              />
            </label>
          )}

          <nav className="sb-nav" aria-label="Navegación principal">
            {sections.map((section) => (
              <div key={section.title}>
                <p className="sb-section" aria-hidden={rail}>
                  {section.title}
                </p>
                {section.items.map((item) => {
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  const badge = item.href === '/notificaciones' ? unread : 0;
                  const name = badge > 0 ? `${item.label}, ${badge} sin leer` : item.label;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="sb-item"
                      aria-current={active ? 'page' : undefined}
                      aria-label={rail ? name : undefined}
                      title={rail ? name : undefined}
                    >
                      <SidebarIcon name={item.icon} />
                      <span className="sb-label">{item.label}</span>
                      {badge > 0 && (
                        <>
                          <span className="sb-badge">{badge > 99 ? '99+' : badge}</span>
                          <span className="sb-dot" aria-hidden="true" />
                        </>
                      )}
                      {active && <span className="sb-accent" aria-hidden="true" />}
                    </Link>
                  );
                })}
              </div>
            ))}
            {sections.length === 0 && <p className="sb-empty">Sin resultados</p>}
          </nav>

          <div className="sb-foot">
            {session && (
              <div className="sb-user" title={roleLabel}>
                <span className="sb-avatar" aria-hidden="true">
                  {initialsOf(roleLabel)}
                </span>
                <div className="sb-who">
                  <strong>{roleLabel}</strong>
                </div>
              </div>
            )}
            <button
              type="button"
              className="sb-logout"
              onClick={() => void logout()}
              aria-label="Cerrar sesión"
              title={rail ? 'Cerrar sesión' : undefined}
            >
              <SidebarIcon name="logout" />
              <span className="sb-label">Cerrar sesión</span>
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
