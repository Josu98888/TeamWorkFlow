'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { formatMeters } from '@/shared/lib/format';

export type MapPersonMarker = {
  id: string;
  name: string;
  postName?: string;
};

type SiteMapProps = {
  siteName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** Small variant for cards: static preview, no zoom controls. */
  compact?: boolean;
  isActive?: boolean;
  activeShifts?: number;
  activePersonnel?: MapPersonMarker[];
};

const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function SiteMap({
  siteName,
  latitude,
  longitude,
  radiusMeters,
  compact = false,
  isActive = true,
  activeShifts = 0,
  activePersonnel = [],
}: SiteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkTheme = () => setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    (async () => {
      const L = await import('leaflet');
      if (cancelled || !containerRef.current) return;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const zoom = radiusMeters <= 100 ? 17 : radiusMeters <= 250 ? 16 : 15;
      const map = L.map(containerRef.current, {
        center: [latitude, longitude],
        zoom,
        zoomControl: !compact,
        attributionControl: false,
        dragging: !compact,
        scrollWheelZoom: false,
        doubleClickZoom: !compact,
        boxZoom: !compact,
        keyboard: !compact,
      });

      L.tileLayer(OSM_TILES, { maxZoom: 19 }).addTo(map);

      const accent = isActive ? '#0d9488' : '#64748b';

      L.circle([latitude, longitude], {
        radius: radiusMeters,
        color: accent,
        weight: 2,
        dashArray: '6 5',
        fillColor: accent,
        fillOpacity: 0.14,
      }).addTo(map);

      // True 3D hollow-center teardrop pin (no white fill, no white outline)
      const pinPalette = isActive
        ? { light: '#5eead4', mid: '#0d9488', deep: '#0f766e', edge: '#042f2e' }
        : { light: '#cbd5e1', mid: '#64748b', deep: '#475569', edge: '#1e293b' };

      const uid = `${Math.abs(Math.round(latitude * 10000))}-${isActive ? 'a' : 'i'}`;
      const beaconHtml = `
        <div style="position:relative;width:34px;height:42px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 5px 6px rgba(15,23,42,0.38));">
          <svg width="34" height="42" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="body-${uid}" cx="32%" cy="22%" r="78%">
                <stop offset="0%" stop-color="${pinPalette.light}" />
                <stop offset="48%" stop-color="${pinPalette.mid}" />
                <stop offset="88%" stop-color="${pinPalette.deep}" />
                <stop offset="100%" stop-color="${pinPalette.edge}" />
              </radialGradient>
              <linearGradient id="bevel-${uid}" x1="17" y1="8" x2="17" y2="21" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="${pinPalette.edge}" stop-opacity="0.75" />
                <stop offset="100%" stop-color="${pinPalette.light}" stop-opacity="0.85" />
              </linearGradient>
            </defs>
            <!-- Hollow 3D body using evenodd so the center hole is genuinely transparent -->
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M17 1.5C9.27 1.5 3 7.77 3 15.5C3 24.9 15.15 36.2 16.18 37.12C16.65 37.54 17.35 37.54 17.82 37.12C18.85 36.2 31 24.9 31 15.5C31 7.77 24.73 1.5 17 1.5ZM17 20.8C19.93 20.8 22.3 18.43 22.3 15.5C22.3 12.57 19.93 10.2 17 10.2C14.07 10.2 11.7 12.57 11.7 15.5C11.7 18.43 14.07 20.8 17 20.8Z"
              fill="url(#body-${uid})"
            />
            <!-- Inner 3D ring bevel -->
            <circle cx="17" cy="15.5" r="5.6" stroke="url(#bevel-${uid})" stroke-width="1.3" fill="none" />
            <!-- Soft top-left 3D specular gloss -->
            <path
              d="M7.6 12.2C8.4 7.8 12.2 4.6 16.8 4.5"
              stroke="rgba(255,255,255,0.55)"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </div>
      `;

      L.marker([latitude, longitude], {
        icon: L.divIcon({
          html: beaconHtml,
          className: '',
          iconSize: [34, 42],
          iconAnchor: [17, 38],
        }),
      })
        .bindTooltip(`${siteName} · ${formatMeters(radiusMeters)}`, { direction: 'top', offset: [0, -36] })
        .addTo(map);

      // Personnel markers as clean 3D spheres (no white border)
      const peopleList: MapPersonMarker[] =
        activePersonnel.length > 0
          ? activePersonnel
          : Array.from({ length: Math.min(activeShifts, 6) }, (_, i) => ({
              id: `shift-${i}`,
              name: `Personal en turno #${i + 1}`,
            }));

      if (isActive && peopleList.length > 0) {
        const seed = Math.abs(Math.round(latitude * 1000 + longitude * 1000));
        const metersToLat = 1 / 111320;
        const metersToLng = 1 / (111320 * Math.cos((latitude * Math.PI) / 180));

        peopleList.forEach((person, idx) => {
          const angle = ((seed + idx * 137.5) % 360) * (Math.PI / 180);
          const distMeters = radiusMeters * (0.25 + ((idx * 29) % 45) / 100);
          const pLat = latitude + Math.sin(angle) * distMeters * metersToLat;
          const pLng = longitude + Math.cos(angle) * distMeters * metersToLng;

          const personHtml = `
            <div style="width:12px;height:12px;border-radius:9999px;background:radial-gradient(circle at 32% 28%, #8b5cf6 0%, #3b1f54 65%, #1e102c 100%);box-shadow:0 2px 5px rgba(15,23,42,0.45);"></div>
          `;
          const marker = L.marker([pLat, pLng], {
            icon: L.divIcon({
              html: personHtml,
              className: '',
              iconSize: [12, 12],
              iconAnchor: [6, 6],
            }),
          }).addTo(map);

          if (!compact) {
            const label = person.postName ? `${person.name} · ${person.postName}` : person.name;
            marker.bindTooltip(label, { direction: 'top', offset: [0, -6] });
          }
        });
      }

      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [latitude, longitude, radiusMeters, compact, isActive, siteName, activeShifts, activePersonnel]);

  const handleRecenter = () => {
    if (!mapRef.current) return;
    const zoom = radiusMeters <= 100 ? 17 : radiusMeters <= 250 ? 16 : 15;
    mapRef.current.setView([latitude, longitude], zoom, { animate: true });
  };

  return (
    <div
      className={`relative w-full overflow-hidden bg-alt ${compact ? 'h-48' : 'h-80 sm:h-96'}`}
      aria-label={`Mapa de ${siteName}: geocerca de ${formatMeters(radiusMeters)}`}
    >
      <div
        ref={containerRef}
        className={`z-0 h-full w-full ${isDark ? '[&_.leaflet-tile-pane]:brightness-90 [&_.leaflet-tile-pane]:contrast-95 [&_.leaflet-tile-pane]:hue-rotate-180 [&_.leaflet-tile-pane]:invert' : '[&_.leaflet-tile-pane]:saturate-90'}`}
      />

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[400] flex items-center justify-between gap-2">
        <span className="rounded-lg border border-line bg-card/95 px-2.5 py-1 font-mono text-[11px] font-medium text-subtitle shadow-sm backdrop-blur-xs">
          {latitude.toFixed(4)}, {longitude.toFixed(4)}
        </span>

        <div className="pointer-events-auto flex items-center gap-1.5">
          <span className="rounded-lg border border-line bg-card/95 px-2.5 py-1 text-[11px] font-semibold text-body shadow-sm backdrop-blur-xs">
            Radio {formatMeters(radiusMeters)}
          </span>

          {!compact && (
            <button
              type="button"
              onClick={handleRecenter}
              className="rounded-lg border border-line bg-card/95 px-2.5 py-1 text-[11px] font-semibold text-title shadow-sm transition-colors hover:bg-alt cursor-pointer"
              title="Centrar en la geocerca"
            >
              Centrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}