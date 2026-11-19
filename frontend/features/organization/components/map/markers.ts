import type * as Leaflet from 'leaflet';

/** Leaflet helpers shared by every map of the app. Pair them with `map.css` and the `tw-map` class. */

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Required by the OpenStreetMap tile usage policy and licence.
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** Zoom that frames a geofence of the given radius. */
export const zoomForRadius = (radiusMeters: number) => (radiusMeters <= 100 ? 17 : radiusMeters <= 250 ? 16 : 15);

export type SiteMarkerState = 'ok' | 'warn' | 'danger' | 'off';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

const BUILDING_GLYPH =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h9v17M14 9h5v12M2 21h20M8 8h3M8 12h3M8 16h3"/></svg>';

/** Gradient teardrop with a building glyph, anchored at its tip. */
export function sitePinIcon(L: typeof Leaflet, isActive = true): Leaflet.DivIcon {
  return L.divIcon({
    html: `<div class="tw-site-pin" data-inactive="${!isActive}">${BUILDING_GLYPH}</div>`,
    className: 'tw-marker',
    iconSize: [34, 34],
    iconAnchor: [17, 41],
  });
}

/** Circular badge with the initial of the site, for overview maps. */
export function siteInitialIcon(L: typeof Leaflet, name: string, state: SiteMarkerState = 'ok'): Leaflet.DivIcon {
  const initial = escapeHtml(name.trim().charAt(0).toUpperCase() || '?');
  return L.divIcon({
    html: `<div class="tw-site-dot" data-state="${state}">${initial}</div>`,
    className: 'tw-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/** Round initials avatar; red ring when `outside` the geofence. */
export function personIcon(L: typeof Leaflet, initials: string, outside = false): Leaflet.DivIcon {
  return L.divIcon({
    html: `<div class="tw-person" data-outside="${outside}">${escapeHtml(initials)}</div>`,
    className: 'tw-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Dashed violet geofence circle (styled by `path.tw-geofence`). */
export function geofenceCircle(
  L: typeof Leaflet,
  center: Leaflet.LatLngExpression,
  radiusMeters: number,
  isActive = true,
): Leaflet.Circle {
  return L.circle(center, { radius: radiusMeters, className: 'tw-geofence', interactive: false }).on('add', (event) => {
    (event.target as Leaflet.Circle).getElement()?.setAttribute('data-inactive', String(!isActive));
  });
}

/** OSM tile layer with the required attribution; the muted look comes from `map.css`. */
export const osmTileLayer = (L: typeof Leaflet) => L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION });
