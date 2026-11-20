'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useResource } from '@/shared/hooks/useResource';
import { notificationsApi } from '../api';
import { announceNotificationsChanged } from '../events';
import { useUnreadCount } from '../useUnreadCount';
import { NotificationItem } from './NotificationItem';

const RECENT_QUERY = { pageSize: 8 };

function RecentNotifications({ onNavigate }: { onNavigate: () => void }) {
  const recent = useResource(notificationsApi.listNotifications, RECENT_QUERY);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      announceNotificationsChanged();
      recent.reload();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const hasUnread = recent.data?.items.some((item) => item.readAt === null) ?? false;

  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-title">Notificaciones</h2>
        <button
          type="button"
          disabled={busy || !hasUnread}
          onClick={() => void mutate(notificationsApi.markAllRead)}
          className="cursor-pointer text-[11px] font-semibold text-link hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Marcar todas como leídas
        </button>
      </div>

      {failed && (
        <p role="alert" className="px-4 py-2 text-xs font-semibold text-danger">
          No pudimos actualizar las notificaciones.
        </p>
      )}

      {recent.error ? (
        <div className="px-4 py-6 text-center">
          <p role="alert" className="text-xs font-semibold text-danger">
            No pudimos cargar las notificaciones.
          </p>
          <button
            type="button"
            onClick={recent.reload}
            className="mt-2 cursor-pointer text-xs font-semibold text-link hover:underline"
          >
            Reintentar
          </button>
        </div>
      ) : !recent.data ? (
        <p role="status" className="px-4 py-6 text-center text-xs text-muted">
          Cargando...
        </p>
      ) : recent.data.items.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted">No tenés notificaciones.</p>
      ) : (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {recent.data.items.map((item) => (
            <NotificationItem
              key={item.id}
              notification={item}
              disabled={busy}
              onMarkRead={(id) => void mutate(() => notificationsApi.markRead(id))}
            />
          ))}
        </ul>
      )}

      <div className="border-t border-line px-4 py-2 text-center">
        <Link href="/notificaciones" onClick={onNavigate} className="text-xs font-semibold text-link hover:underline">
          Ver todas
        </Link>
      </div>
    </>
  );
}

/** Topbar bell: unread badge (polled) and a dropdown with the most recent notifications. */
export function NotificationBell() {
  const { count, refresh } = useUnreadCount();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (!open) refresh();
    setOpen(!open);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={count > 0 ? `Notificaciones, ${count} sin leer` : 'Notificaciones'}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-page text-body transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-medium"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-card shadow-lg">
          <RecentNotifications onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
