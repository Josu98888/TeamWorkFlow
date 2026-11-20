'use client';

import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';
import { MapPill, MapPills } from './map/MapControls';
import { osmTileLayer, siteInitialIcon } from './map/markers';
import type { Site } from '../types';
import './map/map.css';

type SitesOverviewMapProps = {
  sites: Site[];
  /** Called when a site marker is clicked. */
  onSelect?: (siteId: string) => void;
};

/** Every site at its real coordinates, one initial marker each, framed to fit. */
export function SitesOverviewMap({ sites, onSelect }: SitesOverviewMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;

    (async () => {
      const L = await import('leaflet');
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, { zoomControl: false, scrollWheelZoom: false, center: [0, 0], zoom: 2 });
      osmTileLayer(L).addTo(map);

      const points = sites.map((site) => {
        const position: Leaflet.LatLngTuple = [site.latitude, site.longitude];
        L.marker(position, { icon: siteInitialIcon(L, site.name, site.isActive ? 'ok' : 'off') })
          .bindTooltip(site.name, { direction: 'top', offset: [0, -14] })
          .on('click', () => onSelectRef.current?.(site.id))
          .addTo(map as Leaflet.Map);
        return position;
      });
      if (points.length > 0) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    })();

    return () => {
      cancelled = true;
      map?.remove();
      map = null;
    };
  }, [sites]);

  const active = sites.filter((site) => site.isActive).length;

  return (
    <div className="relative h-[180px] w-full overflow-hidden sm:h-[230px]" role="group" aria-label="Mapa de todas las sedes">
      <div ref={containerRef} className="tw-map z-0 h-full w-full" />
      <MapPills>
        <MapPill>
          {sites.length} {sites.length === 1 ? 'sede' : 'sedes'} · {active} {active === 1 ? 'activa' : 'activas'}
        </MapPill>
      </MapPills>
    </div>
  );
}
