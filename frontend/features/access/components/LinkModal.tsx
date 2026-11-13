'use client';

import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { formatDateTime } from '@/shared/lib/format';

/** Shows a single-use link (invitation or password reset) that the backend returns only once. */
export function LinkModal({ title, path, token, expiresAt, onClose }: { title: string; path: string; token: string; expiresAt: string; onClose: () => void }) {
  const link = `${window.location.origin}${path}?token=${encodeURIComponent(token)}`;
  return (
    <Modal title={title} onClose={onClose}>
      <p className="mb-2 text-xs text-muted">
        Compartí este enlace con la persona. Se muestra una sola vez y vence el {formatDateTime(expiresAt)}.
      </p>
      <code className="block break-all rounded-lg border border-line bg-alt p-3 text-xs text-title">{link}</code>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={() => void navigator.clipboard?.writeText(link)}>Copiar enlace</Button>
        <Button variant="primary" onClick={onClose}>
          Listo
        </Button>
      </div>
    </Modal>
  );
}
