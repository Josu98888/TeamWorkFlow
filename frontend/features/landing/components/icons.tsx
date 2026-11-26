import type { PainIcon } from '../content';

const base = {
  width: 28,
  height: 28,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const PHONE_PATH =
  'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z';

/** Stroke icon for a pain card. */
export function PainIconSvg({ icon }: { icon: PainIcon }) {
  switch (icon) {
    case 'clock':
      return (
        <svg {...base}>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 14" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...base}>
          <path d={PHONE_PATH} />
        </svg>
      );
    case 'chat':
      return (
        <svg {...base}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'sheet':
      return (
        <svg {...base}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      );
  }
}

export function PhoneIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d={PHONE_PATH} />
    </svg>
  );
}

export function PlayIcon({ size = 18, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg {...base} width={size} height={size} fill={filled ? 'currentColor' : 'none'}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

export function ChatBubbleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg {...base} width={24} height={24}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

export function ArrowsIcon() {
  return (
    <svg {...base} width={22} height={22} strokeWidth={2.5}>
      <polyline points="9 6 3 12 9 18" />
      <polyline points="15 6 21 12 15 18" />
    </svg>
  );
}
