/** Initials avatar. `muted` renders the empty placeholder (nobody assigned). */
export function Avatar({ initials, label, muted = false }: { initials: string; label: string; muted?: boolean }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
        muted ? 'bg-alt text-muted' : 'bg-brand-lavender text-brand-dark'
      }`}
    >
      {initials}
    </span>
  );
}
