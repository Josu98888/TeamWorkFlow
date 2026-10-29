export function Avatar({ initials, label }: { initials: string; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-lavender text-[11px] font-bold text-brand-dark"
    >
      {initials}
    </span>
  );
}
