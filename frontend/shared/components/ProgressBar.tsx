import { TONE_BAR, type Tone } from './Badge';

type ProgressBarProps = {
  value: number;
  max: number;
  tone?: Tone;
  label: string;
};

export function ProgressBar({ value, max, tone = 'success', label }: ProgressBarProps) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-2 w-full overflow-hidden rounded-full bg-alt"
    >
      <div className={`h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${percent}%` }} />
    </div>
  );
}
