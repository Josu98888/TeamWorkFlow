import { formatMeters } from '@/shared/lib/format';

type SiteMapProps = {
  siteName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** Small variant for cards: no caption, no scale bar. */
  compact?: boolean;
  /** Optional operational telemetry for live radar and personnel dots. */
  isActive?: boolean;
  activeShifts?: number;
};

const WIDTH = 400;
const HEIGHT = 240;
const MIN_RADIUS_PX = 36;
const MAX_RADIUS_PX = 96;
const MAX_REFERENCE_METERS = 300;

/**
 * Tactical vector map: deterministic urban blocks, 2.5D building reliefs,
 * geofence radar, and live shift presence markers using theme tokens.
 */
export function SiteMap({
  siteName,
  latitude,
  longitude,
  radiusMeters,
  compact = false,
  isActive = true,
  activeShifts = 0,
}: SiteMapProps) {
  const seed = Math.abs(Math.round(latitude * 1000 + longitude * 1000));
  const tilt = (seed % 41) - 20;
  const radiusPx = Math.min(
    MAX_RADIUS_PX,
    MIN_RADIUS_PX + (Math.min(radiusMeters, MAX_REFERENCE_METERS) / MAX_REFERENCE_METERS) * (MAX_RADIUS_PX - MIN_RADIUS_PX),
  );
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  const visibleDots = Math.min(activeShifts, 6);
  const presenceMarkers = Array.from({ length: visibleDots }, (_, idx) => {
    const angle = ((seed + idx * 137.5) % 360) * (Math.PI / 180);
    const dist = radiusPx * (0.28 + ((idx * 29) % 45) / 100);
    return {
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist,
    };
  });

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Mapa referencial de ${siteName}: geocerca de ${formatMeters(radiusMeters)}`}
      className="block h-auto w-full rounded-lg"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width={WIDTH} height={HEIGHT} className="fill-alt" />

      {/* Subtle tactical coordinate grid */}
      <g className="stroke-line/40" strokeWidth={0.5} strokeDasharray="2 4">
        <line x1={0} y1={cy - 60} x2={WIDTH} y2={cy - 60} />
        <line x1={0} y1={cy + 60} x2={WIDTH} y2={cy + 60} />
        <line x1={cx - 100} y1={0} x2={cx - 100} y2={HEIGHT} />
        <line x1={cx + 100} y1={0} x2={cx + 100} y2={HEIGHT} />
      </g>

      <g transform={`rotate(${tilt} ${cx} ${cy})`}>
        {/* Urban blocks with subtle 2.5D isometric depth */}
        {[-120, 0, 120, 240, 360, 480].flatMap((x, xi) =>
          [-80, 20, 120, 220, 320].map((y, yi) => {
            const isGreenZone = (xi + yi + seed) % 7 === 0;
            return (
              <g key={`${x}-${y}`}>
                <rect x={x - 37} y={y - 36} width={96} height={72} rx={6} className="fill-line/45" />
                <rect
                  x={x - 40}
                  y={y - 40}
                  width={96}
                  height={72}
                  rx={6}
                  className={isGreenZone ? 'fill-brand-teal/10 stroke-brand-teal/25' : 'fill-card stroke-line/60'}
                  strokeWidth={0.75}
                />
              </g>
            );
          }),
        )}

        {/* Main avenues with center lane markings */}
        <rect x={-100} y={cy - 8} width={WIDTH + 200} height={16} className="fill-hover" />
        <line
          x1={-100}
          y1={cy}
          x2={WIDTH + 100}
          y2={cy}
          className="stroke-line"
          strokeWidth={1}
          strokeDasharray="6 6"
        />

        <rect x={cx + 52} y={-100} width={16} height={HEIGHT + 200} className="fill-hover" />
        <line
          x1={cx + 60}
          y1={-100}
          x2={cx + 60}
          y2={HEIGHT + 100}
          className="stroke-line"
          strokeWidth={1}
          strokeDasharray="6 6"
        />

        {/* Secondary curved road */}
        <path
          d={`M -100 ${cy + 70} Q ${cx} ${cy + 20} ${WIDTH + 100} ${cy + 90}`}
          className="fill-none stroke-line"
          strokeWidth={5}
        />
      </g>

      {/* Outer buffer ring */}
      <circle
        cx={cx}
        cy={cy}
        r={radiusPx + 10}
        className="fill-none stroke-brand-teal/25"
        strokeWidth={1}
        strokeDasharray="2 3"
      />

      {/* Active Geofence */}
      <circle
        cx={cx}
        cy={cy}
        r={radiusPx}
        className={isActive ? 'fill-brand-teal/15 stroke-brand-teal' : 'fill-muted/10 stroke-muted'}
        strokeWidth={2}
        strokeDasharray="6 4"
      />
      <line
        x1={cx}
        y1={cy}
        x2={cx + radiusPx}
        y2={cy}
        className={isActive ? 'stroke-brand-teal' : 'stroke-muted'}
        strokeWidth={1.5}
      />

      {/* Live personnel markers inside perimeter */}
      {isActive &&
        presenceMarkers.map((dot, idx) => (
          <g key={idx} transform={`translate(${dot.x} ${dot.y})`}>
            <circle r={4.5} className="fill-brand-dark stroke-card" strokeWidth={1.5} />
          </g>
        ))}

      {/* Center beacon */}
      {isActive && (
        <circle cx={cx} cy={cy} r={14} className="fill-brand-teal/20" />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={6.5}
        className={isActive ? 'fill-brand-teal stroke-card' : 'fill-muted stroke-card'}
        strokeWidth={2.5}
      />

      {/* GPS coordinates pill (visible in both compact & detail views) */}
      <g transform={`translate(12 ${HEIGHT - 24})`}>
        <rect width={132} height={16} rx={8} className="fill-card/90 stroke-line/80" strokeWidth={0.75} />
        <text x={66} y={11} textAnchor="middle" className="fill-subtitle font-mono text-[8.5px] font-medium">
          {latitude.toFixed(4)}, {longitude.toFixed(4)}
        </text>
      </g>

      {/* Radius badge */}
      <g transform={`translate(${cx + radiusPx / 2 - 22} ${cy - 21})`}>
        <rect width={44} height={16} rx={8} className="fill-card stroke-line" strokeWidth={0.75} />
        <text x={22} y={11.5} textAnchor="middle" className="fill-body text-[9px] font-semibold">
          {formatMeters(radiusMeters)}
        </text>
      </g>

      {!compact && (
        <>
          <g transform={`translate(${WIDTH - 36} 32)`} className="text-[10px] font-bold">
            <circle r={14} className="fill-card stroke-line" />
            <path d="M 0 -8 L 4 4 L 0 1 L -4 4 Z" className="fill-brand-dark" />
            <text y={-17} textAnchor="middle" className="fill-muted text-[8px] font-bold">
              N
            </text>
          </g>
          <g transform={`translate(${WIDTH - 116} ${HEIGHT - 24})`}>
            <rect width={104} height={16} rx={8} className="fill-card/90 stroke-line/80" strokeWidth={0.75} />
            <text x={52} y={11} textAnchor="middle" className="fill-muted text-[8px] font-semibold uppercase tracking-wider">
              Geocerca GPS
            </text>
          </g>
        </>
      )}
    </svg>
  );
}