import type { ReactNode } from 'react';
import './map.css';

/** Square rounded zoom buttons for a map card; `onZoomIn`/`onZoomOut` call the Leaflet map. */
export function MapZoomControls({ onZoomIn, onZoomOut }: { onZoomIn: () => void; onZoomOut: () => void }) {
  return (
    <div className="tw-map-zoom">
      <button type="button" aria-label="Acercar" onClick={onZoomIn}>
        +
      </button>
      <button type="button" aria-label="Alejar" onClick={onZoomOut}>
        &minus;
      </button>
    </div>
  );
}

/** Glass pills over the bottom-left corner of a map. */
export function MapPills({ children }: { children: ReactNode }) {
  return <div className="tw-map-pills">{children}</div>;
}

export function MapPill({ tone = 'plain', children }: { tone?: 'success' | 'danger' | 'plain'; children: ReactNode }) {
  return (
    <span className="tw-map-pill" data-tone={tone}>
      {children}
    </span>
  );
}
