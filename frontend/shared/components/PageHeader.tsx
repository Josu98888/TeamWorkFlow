import Link from 'next/link';
import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  back?: { href: string; label: string };
};

export function PageHeader({ title, description, actions, back }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-xs font-medium text-link hover:underline">
            &larr; {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-title">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
