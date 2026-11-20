import Link from 'next/link';
import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  /** Primary actions, right-aligned. */
  actions?: ReactNode;
  /** Outline actions placed before `actions`; hidden on phones. */
  secondaryActions?: ReactNode;
  /** Status badge shown next to the title. */
  badge?: ReactNode;
  back?: { href: string; label: string };
};

export function PageHeader({ title, description, actions, secondaryActions, badge, back }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-xs font-medium text-link hover:underline">
            &larr; {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight text-title">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {(secondaryActions || actions) && (
        <div className="flex items-center gap-2">
          {secondaryActions && <div className="hidden items-center gap-2 sm:flex">{secondaryActions}</div>}
          {actions}
        </div>
      )}
    </div>
  );
}
