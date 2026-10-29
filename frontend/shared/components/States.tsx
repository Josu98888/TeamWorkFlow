import type { ReactNode } from 'react';
import { Button } from './Button';
import { Card } from './Card';

/** Pulsing placeholder blocks while a resource loads. */
export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Cargando" className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-xl border border-line bg-card" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-xl border border-line bg-card" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="text-center">
      <p role="alert" className="text-sm font-semibold text-danger">
        {message}
      </p>
      {onRetry && (
        <Button className="mt-3" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-semibold text-title">{title}</p>
      {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      {action}
    </div>
  );
}
