import type { CSSProperties } from 'react';
import './site-tile.css';

const TILE_SIZE = 256;

/**
 * Slippy-map tile that contains the point, plus the position of the point inside it (0..1).
 * The zoom is the closest one at which the geofence ring still fits in a 120px strip.
 */
function tileFor(latitude: number, longitude: number, radiusMeters: number) {
  const latRad = (latitude * Math.PI) / 180;
  let zoom = 18;
  // Ring diameter as a fraction of one tile; keep it under ~22% so it fits the strip.
  while (zoom > 10) {
    const metersPerPixel = (156543.03392 * Math.cos(latRad)) / 2 ** zoom;
    if ((2 * radiusMeters) / (metersPerPixel * TILE_SIZE) <= 0.22) break;
    zoom -= 1;
  }
  const scale = 2 ** zoom;
  const worldX = ((longitude + 180) / 360) * scale;
  const worldY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  const metersPerPixel = (156543.03392 * Math.cos(latRad)) / scale;
  return {
    zoom,
    x: Math.floor(worldX),
    y: Math.floor(worldY),
    fx: worldX - Math.floor(worldX),
    fy: worldY - Math.floor(worldY),
    ring: (2 * radiusMeters) / (metersPerPixel * TILE_SIZE),
  };
}

/**
 * Static preview of a site: one OSM tile (lazy, no Leaflet instance) with the geofence ring and the pin drawn in CSS.
 * The page that renders it must show the OpenStreetMap attribution.
 */
export function SiteTilePreview({
  latitude,
  longitude,
  radiusMeters,
  isActive,
}: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
}) {
  const { zoom, x, y, fx, fy, ring } = tileFor(latitude, longitude, radiusMeters);
  const stage = { '--fx': fx, '--fy': fy, '--ring': ring } as CSSProperties;

  return (
    <div className="site-tile" data-inactive={!isActive}>
      <div className="site-tile-stage" style={stage}>
        {/* eslint-disable-next-line @next/next/no-img-element -- external OSM tile, no optimization wanted */}
        <img
          src={`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`}
          alt=""
          loading="lazy"
          decoding="async"
          className="site-tile-img"
        />
        <span className="site-tile-ring" />
        <span className="site-tile-pin" />
      </div>
    </div>
  );
}
