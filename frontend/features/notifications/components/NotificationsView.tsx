'use client';

import { useState } from 'react';
import { Button, FilterChip } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState } from '@/shared/components/States';
import { RowList } from '@/shared/components/List';
import { useResource } from '@/shared/hooks/useResource';
import { notificationsApi } from '../api';
import { announceNotificationsChanged } from '../events';
import { NotificationItem } from './NotificationItem';

const PAGE_SIZE = 20;

export function NotificationsView() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const list = useResource(notificationsApi.listNotifications, { page, pageSize: PAGE_SIZE, unreadOnly });

  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(false);
    try {
      await action();
      announceNotificationsChanged();
      list.reload();
    } catch {
      setActionError(true);
    } finally {
      setBusy(false);
    }
  };

  const selectFilter = (value: boolean) => {
    setUnreadOnly(value);
    setPage(1);
  };

  const header = (
    <PageHeader
      title="Notificaciones"
      description="Avisos de tareas, turnos, alertas y facturación."
      actions={
        <Button disabled={busy || !list.data} onClick={() => void mutate(notificationsApi.markAllRead)}>
          Marcar todas como leídas
        </Button>
      }
    />
  );

  const filters = (
    <div className="mb-4 flex flex-wrap gap-2">
      <FilterChip label="Todas" active={!unreadOnly} onSelect={() => selectFilter(false)} />
      <FilterChip label="Sin leer" active={unreadOnly} onSelect={() => selectFilter(true)} />
    </div>
  );

  if (list.error) {
    return (
      <>
        {header}
        {filters}
        <ErrorState message="No pudimos cargar las notificaciones." onRetry={list.reload} />
      </>
    );
  }

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      {header}
      {filters}
      {actionError && (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger">
          No pudimos actualizar las notificaciones. Intentá de nuevo.
        </p>
      )}

      {!list.data ? (
        <div role="status" aria-label="Cargando" className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="state-skeleton h-16" />
          ))}
        </div>
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={unreadOnly ? 'No tenés notificaciones sin leer' : 'No tenés notificaciones'}
          description="Cuando haya novedades las vas a ver acá."
        />
      ) : (
        <>
          <Card flush glow="none">
            <RowList>
              {list.data.items.map((item) => (
                <NotificationItem
                  key={item.id}
                  variant="row"
                  notification={item}
                  disabled={busy}
                  onMarkRead={(id) => void mutate(() => notificationsApi.markRead(id))}
                />
              ))}
            </RowList>
          </Card>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-xs text-muted">
              <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <span>
                Página {page} de {totalPages}
              </span>
              <Button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Siguiente
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
