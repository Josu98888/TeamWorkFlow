'use client';

import { useState } from 'react';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { useAction } from '@/shared/hooks/useAction';
import { organizationApi } from '../api';

/** Rotates the QR of a site and shows the new code once it is returned. */
export function RotateQrButton({ siteId, onRotated }: { siteId: string; onRotated: () => void }) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const { run, pending, error } = useAction();

  const rotate = async () => {
    if (!window.confirm('Rotar el QR invalida el código anterior. ¿Continuar?')) return;
    const site = await run(() => organizationApi.rotateSiteQr(siteId));
    if (site) {
      setQrCode(site.qrCode ?? '(sin código)');
      onRotated();
    }
  };

  return (
    <>
      <Button onClick={rotate} disabled={pending}>
        {pending ? 'Rotando...' : 'Rotar QR'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      {qrCode && (
        <Modal title="Nuevo código QR" onClose={() => setQrCode(null)}>
          <p className="mb-2 text-xs text-muted">Este es el nuevo valor del QR de la sede.</p>
          <code className="block break-all rounded-lg border border-line bg-alt p-3 text-xs text-title">{qrCode}</code>
          <div className="mt-3 flex justify-end gap-2">
            <Button onClick={() => void navigator.clipboard?.writeText(qrCode)}>Copiar</Button>
            <Button variant="primary" onClick={() => setQrCode(null)}>
              Listo
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
