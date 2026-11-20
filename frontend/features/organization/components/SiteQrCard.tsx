'use client';

import { useState } from 'react';
import { Button } from '@/shared/components/Button';
import { Card, SectionLabel } from '@/shared/components/Card';
import { formatDate } from '@/shared/lib/format';
import type { Site } from '../types';
import { RotateQrButton } from './RotateQrButton';
import './site-qr.css';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Opens a plain print view with the code, the name and the address of the site. */
function printQr(site: Site) {
  const popup = window.open('', '_blank', 'width=720,height=900');
  if (!popup) return;
  popup.document.write(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR · ${escapeHtml(site.name)}</title></head>` +
      `<body style="font-family:sans-serif;text-align:center;padding:48px;color:black;background:white">` +
      `<h1 style="margin:0 0 4px">${escapeHtml(site.name)}</h1><p style="margin:0 0 32px">${escapeHtml(site.address)}</p>` +
      `<p style="font-family:monospace;font-size:28px;word-break:break-all;border:4px solid black;padding:32px;border-radius:24px">${escapeHtml(site.qrCode ?? '')}</p>` +
      `</body></html>`,
  );
  popup.document.close();
  popup.focus();
  popup.print();
}

/** QR of a site: the code as text (no QR image library yet), with rotate, copy and print. */
export function SiteQrCard({ site, onRotated }: { site: Site; onRotated: () => void }) {
  const [copied, setCopied] = useState(false);
  const code = site.qrCode;

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card>
      <SectionLabel>QR de la sede</SectionLabel>
      <div className="site-qr-box">{code ? <code>{code}</code> : <span>Sin código generado</span>}</div>
      <p className="mt-3 text-center text-xs text-muted">
        {site.qrRotatedAt ? `Última renovación: ${formatDate(site.qrRotatedAt)}` : 'Todavía no se renovó.'}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <RotateQrButton siteId={site.id} onRotated={onRotated} label="Renovar" />
        {code && (
          <>
            <Button onClick={() => void copy()}>{copied ? 'Copiado' : 'Copiar'}</Button>
            <Button onClick={() => printQr(site)}>Imprimir</Button>
          </>
        )}
      </div>
    </Card>
  );
}
