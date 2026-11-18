import type { ReactNode } from 'react';
import './card.css';

export type CardGlow = 'corner' | 'bottom' | 'none';

type CardProps = {
  children: ReactNode;
  className?: string;
  /** Remove the inner padding (lists that bleed to the edges). */
  flush?: boolean;
  /** Violet glow: bottom-right corner (default), along the bottom edge, or none (forms, dense tables). */
  glow?: CardGlow;
  /** Linked card: lifts and grows the glow on hover. */
  interactive?: boolean;
};

export function Card({ children, className = '', flush = false, glow = 'corner', interactive = false }: CardProps) {
  return (
    <div
      data-glow={glow}
      data-interactive={interactive}
      className={`glow-card ${flush ? '' : 'p-5'} ${className}`.trim()}
    >
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
