import type { ReactNode } from 'react';
import './list.css';

/** Filter/search bar placed above a list; children are the Fields. */
export function Toolbar({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 }) {
  return (
    <div className={`list-toolbar grid-cols-1 ${columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</div>
  );
}

/** Stacked rows list; place inside `<Card flush glow="none">`. Rows wrap on narrow screens. */
export function RowList({ children }: { children: ReactNode }) {
  return <ul className="list-rows">{children}</ul>;
}

type ListRowProps = {
  children: ReactNode;
  /** Leading element (Avatar, icon chip). */
  leading?: ReactNode;
  /** Right-aligned content (chips, actions). */
  trailing?: ReactNode;
  /** Highlights the row (e.g. unread). */
  highlighted?: boolean;
  className?: string;
};

export function ListRow({ children, leading, trailing, highlighted = false, className = '' }: ListRowProps) {
  return (
    <li data-unread={highlighted} className={`list-row ${className}`.trim()}>
      {leading}
      <div className="min-w-0 flex-1 basis-48">{children}</div>
      {trailing && <div className="flex flex-wrap items-center gap-2">{trailing}</div>}
    </li>
  );
}

/** Table that keeps its width and scrolls horizontally inside the card on small screens. */
export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="table-scroll">
      <table className="data-table">{children}</table>
    </div>
  );
}
