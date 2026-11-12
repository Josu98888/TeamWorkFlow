import type { ReactNode } from 'react';

type CardProps = {
  children: ReactNode;
  className?: string;
  /** Remove the inner padding (lists that bleed to the edges). */
  flush?: boolean;
};

export function Card({ children, className = '', flush = false }: CardProps) {
  return (
    <div className={`rounded-xl border border-line bg-card shadow-sm ${flush ? '' : 'p-5'} ${className}`}>
      {children}
    </div>
  );
}

/** Uppercase micro-label used as a card/section heading. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}
