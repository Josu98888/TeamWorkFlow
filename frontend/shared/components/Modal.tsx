'use client';

import type { ReactNode } from 'react';
import { Button } from './Button';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/** Simple centered dialog over a dimmed backdrop. */
export function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} className="mt-10 w-full max-w-lg rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-title">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Cerrar">
            Cerrar
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
