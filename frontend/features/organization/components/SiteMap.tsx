import { formatMeters } from '@/shared/lib/format';

type SiteMapProps = {
  siteName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** Small variant for cards: no caption, no scale bar. */
  compact?: boolean;
};

const WIDTH = 400;
const HEIGHT = 240;
const MIN_RADIUS_PX = 36;
const MAX_RADIUS_PX = 96;
const MAX_REFERENCE_METERS = 300;

/**
 * Static map placeholder (no map library): decorative street grid plus the geofence circle.
 * The street layout is derived from the coordinates so every site looks different but stable.
 * TODO(maps): replace with a real map once a provider is chosen.
 */
export function SiteMap({ siteName, latitude, longitude, radiusMeters, compact = false }: SiteMapProps) {
  const tilt = (Math.abs(Math.round(latitude * 1000 + longitude * 1000)) % 41) - 20;
  const radiusPx = Math.min(
    MAX_RADIUS_PX,
    MIN_RADIUS_PX + (Math.min(radiusMeters, MAX_REFERENCE_METERS) / MAX_REFERENCE_METERS) * (MAX_RADIUS_PX - MIN_RADIUS_PX),
  );
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Mapa referencial de ${siteName}: geocerca de ${formatMeters(radiusMeters)}`}
      className="block h-auto w-full rounded-lg"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width={WIDTH} height={HEIGHT} className="fill-alt" />

      <g transform={`rotate(${tilt} ${cx} ${cy})`}>
        {/* Blocks */}
        {[-120, 0, 120, 240, 360, 480].flatMap((x) =>
          [-80, 20, 120, 220, 320].map((y) => (
            <rect key={`${x}-${y}`} x={x - 40} y={y - 40} width={96} height={72} rx={6} className="fill-card" />
          )),
        )}
        {/* Avenues */}
        <rect x={-100} y={cy - 7} width={WIDTH + 200} height={14} className="fill-hover" />
        <rect x={cx - 7 + 60} y={-100} width={14} height={HEIGHT + 200} className="fill-hover" />
        <path
          d={`M -100 ${cy + 70} Q ${cx} ${cy + 20} ${WIDTH + 100} ${cy + 90}`}
          className="fill-none stroke-line"
          strokeWidth={5}
        />
      </g>

      {/* Geofence */}
      <circle cx={cx} cy={cy} r={radiusPx} className="fill-brand-teal/20 stroke-brand-teal" strokeWidth={2} strokeDasharray="6 4" />
      <line x1={cx} y1={cy} x2={cx + radiusPx} y2={cy} className="stroke-brand-teal" strokeWidth={1.5} />

      {/* Pin */}
      <circle cx={cx} cy={cy} r={7} className="fill-brand-teal stroke-card" strokeWidth={3} />

      {!compact && (
        <>
          <g transform={`translate(${cx + radiusPx / 2 - 22} ${cy - 20})`}>
            <rect width={44} height={16} rx={8} className="fill-card stroke-line" />
            <text x={22} y={11.5} textAnchor="middle" className="fill-body text-[9px] font-semibold">
              {formatMeters(radiusMeters)}
            </text>
          </g>
          <g transform={`translate(${WIDTH - 40} 30)`} className="text-[10px] font-bold">
            <circle r={14} className="fill-card stroke-line" />
            <path d="M 0 -8 L 4 4 L 0 1 L -4 4 Z" className="fill-brand-dark" />
            <text y={-17} textAnchor="middle" className="fill-muted text-[8px] font-bold">
              N
            </text>
          </g>
          <g transform={`translate(16 ${HEIGHT - 20})`}>
            <rect width={150} height={14} rx={7} className="fill-card/90" />
            <text x={75} y={10} textAnchor="middle" className="fill-muted text-[8px] font-semibold uppercase tracking-wider">
              Mapa referencial
            </text>
          </g>
        </>
      )}
    </svg>
  );
}
