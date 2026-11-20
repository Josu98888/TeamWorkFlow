'use client';

import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';
import { formatMeters } from '@/shared/lib/format';
import { MapPill, MapPills, MapZoomControls } from './map/MapControls';
import { geofenceCircle, osmTileLayer, personIcon, sitePinIcon, zoomForRadius } from './map/markers';
import './map/map.css';

export type MapPersonMarker = {
  id: string;
  name: string;
  initials: string;
  postName?: string;
  /** Red ring when the person is outside the geofence. Only set it when the data exists. */
  outside?: boolean;
};

type SiteMapProps = {
  siteName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive?: boolean;
  activePersonnel?: MapPersonMarker[];
};

export function SiteMap({
  siteName,
  latitude,
  longitude,
  radiusMeters,
  isActive = true,
  activePersonnel = [],
}: SiteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  // Stable key: the parent rebuilds the array on every render and the map must not be recreated for that.
  const personnelKey = JSON.stringify(activePersonnel);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = await import('leaflet');
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [latitude, longitude],
        zoom: zoomForRadius(radiusMeters),
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false,
      });
      osmTileLayer(L).addTo(map);
      geofenceCircle(L, [latitude, longitude], radiusMeters, isActive).addTo(map);

      L.marker([latitude, longitude], { icon: sitePinIcon(L, isActive), zIndexOffset: 1000 })
        .bindTooltip(`${siteName} · ${formatMeters(radiusMeters)}`, { direction: 'top', offset: [0, -42] })
        .addTo(map);

      // The API gives no live position per person: markers are spread deterministically inside the geofence.
      const personnel = JSON.parse(personnelKey) as MapPersonMarker[];
      if (isActive) {
        const seed = Math.abs(Math.round(latitude * 1000 + longitude * 1000));
        const metersToLat = 1 / 111320;
        const metersToLng = 1 / (111320 * Math.cos((latitude * Math.PI) / 180));

        personnel.slice(0, 8).forEach((person, idx) => {
          const angle = ((seed + idx * 137.5) % 360) * (Math.PI / 180);
          const distMeters = radiusMeters * (0.35 + ((idx * 29) % 45) / 100);
          const position: Leaflet.LatLngExpression = [
            latitude + Math.sin(angle) * distMeters * metersToLat,
            longitude + Math.cos(angle) * distMeters * metersToLng,
          ];
          const label = person.postName ? `${person.name} · ${person.postName}` : person.name;
          L.marker(position, { icon: personIcon(L, person.initials, person.outside) })
            .bindTooltip(label, { direction: 'top', offset: [0, -14] })
            .addTo(map);
        });
      }

      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude, radiusMeters, isActive, siteName, personnelKey]);

  const outside = activePersonnel.filter((person) => person.outside).length;
  const inside = activePersonnel.length - outside;

  return (
    <div
      className="relative h-[300px] w-full overflow-hidden sm:h-[380px]"
      role="group"
      aria-label={`Mapa de ${siteName}: geocerca de ${formatMeters(radiusMeters)}`}
    >
      <div ref={containerRef} className="tw-map z-0 h-full w-full" />
      <MapZoomControls onZoomIn={() => mapRef.current?.zoomIn()} onZoomOut={() => mapRef.current?.zoomOut()} />
      {activePersonnel.length > 0 && (
        <MapPills>
          <MapPill tone="success">{inside} en turno</MapPill>
          {outside > 0 && <MapPill tone="danger">{outside} fuera de geocerca</MapPill>}
        </MapPills>
      )}
    </div>
  );
}
