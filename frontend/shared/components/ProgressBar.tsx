import { TONE_BAR, type Tone } from './Badge';
import './progress.css';

/** `brand` (violet gradient) for general progress, `done` (teal gradient) for completed work; the rest are status tones. */
export type ProgressTone = Tone | 'brand' | 'done';

type ProgressBarProps = {
  value: number;
  max: number;
  tone?: ProgressTone;
  label: string;
};

const isGradient = (tone: ProgressTone): tone is 'brand' | 'done' => tone === 'brand' || tone === 'done';

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
      {isGradient(tone) ? (
        <div className="progress-fill h-full rounded-full" data-tone={tone} style={{ width: `${percent}%` }} />
      ) : (
        <div className={`h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${percent}%` }} />
      )}
    </div>
  );
}
