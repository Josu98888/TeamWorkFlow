import Link from 'next/link';
import { Card } from './Card';
import { TONE_TEXT, type Tone } from './Badge';

type KpiTileProps = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
  href?: string;
};

export function KpiTile({ label, value, hint, tone = 'neutral', href }: KpiTileProps) {
  const content = (
    <Card className={href ? 'h-full transition-colors hover:bg-alt' : 'h-full'}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${tone === 'neutral' ? 'text-title' : TONE_TEXT[tone]}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );

  return href ? (
    <Link
      href={href}
      className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-medium"
    >
      {content}
    </Link>
  ) : (
    content
  );
}
