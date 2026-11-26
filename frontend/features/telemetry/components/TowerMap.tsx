'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { MapZoomControls, osmTileLayer } from '@/features/organization';
import './tower.css';

export type TowerSiteState = 'ok' | 'warn' | 'danger';

export type TowerMapSite = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  present: number;
  expected: number;
  state: TowerSiteState;
};

type TowerMapProps = {
  sites: readonly TowerMapSite[];
  /** Site currently filtering the view (ringed on the map). */
  selectedId: string | null;
  /** Centers the map on a site; a new `nonce` re-centers even on the same site. */
  focus: { siteId: string; nonce: number } | null;
  onSelect: (siteId: string) => void;
  onResetView?: () => void;
};

const FOCUS_ZOOM = 16;

/** DOM node of a marker: dashed circle with presentes/esperados and the site name underneath. */
function markerElement(site: TowerMapSite, selected: boolean): HTMLElement {
  const circle = document.createElement('div');
  circle.className = 'tw-tower-site';
  circle.dataset.state = site.state;
  circle.dataset.selected = String(selected);
  circle.textContent = `${site.present}/${site.expected}`;
  const label = document.createElement('span');
  label.className = 'tw-tower-label';
  label.textContent = site.name;
  circle.appendChild(label);
  return circle;
}

/** Every site at its real coordinates with its presence; violet complete, amber missing people, red with an open alert. */
export function TowerMap({ sites, selectedId, focus, onSelect, onResetView }: TowerMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [isZoomedIn, setIsZoomedIn] = useState(false);
  // Coordinates only: live presence updates must not reframe the map.
  const framingKey = sites.map((site) => `${site.id}:${site.latitude}:${site.longitude}`).join('|');

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
const fitAllSites = useCallback(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || sites.length === 0) return;
    map.flyToBounds(L.latLngBounds(sites.map((site): Leaflet.LatLngTuple => [site.latitude, site.longitude])), {
      padding: [60, 60],
      maxZoom: 16,
      duration: 0.6,
    });
    setIsZoomedIn(false);
    onResetView?.();
  }, [sites, onResetView]);

  // The map exists once; markers and framing are separate effects below.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = await import('leaflet');
      if (cancelled || !containerRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: false, scrollWheelZoom: false, center: [0, 0], zoom: 2 });
      osmTileLayer(L).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      leafletRef.current = L;
      mapRef.current = map;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      leafletRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    for (const site of sites) {
      L.marker([site.latitude, site.longitude], {
        icon: L.divIcon({
          html: markerElement(site, site.id === selectedId),
          className: 'tw-marker',
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
        zIndexOffset: site.state === 'danger' ? 500 : 0,
        keyboard: false,
      })
        .on('click', () => onSelectRef.current(site.id))
        .addTo(layer);
    }
  }, [ready, sites, selectedId]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || sites.length === 0) return;
    map.fitBounds(L.latLngBounds(sites.map((site): Leaflet.LatLngTuple => [site.latitude, site.longitude])), {
      padding: [60, 60],
      maxZoom: 16,
    });
    setIsZoomedIn(false);
    // Reframe only when the set of coordinates changes, not on every presence update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, framingKey]);

  useEffect(() => {
    const map = mapRef.current;
    const site = focus && sites.find((item) => item.id === focus.siteId);
    if (!ready || !map || !site) return;
    map.flyTo([site.latitude, site.longitude], Math.max(map.getZoom(), FOCUS_ZOOM), { duration: 0.6 });
    setIsZoomedIn(true);
    // Only a new focus request moves the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focus]);

  return (
    <div className="relative h-[300px] w-full overflow-hidden sm:h-[420px]" role="group" aria-label="Mapa de presencia por sede">
      <div ref={containerRef} className="tw-map z-0 h-full w-full" />
      {(isZoomedIn || selectedId) && (
        <button
          type="button"
          onClick={fitAllSites}
          className="absolute left-3 top-3 z-[400] inline-flex items-center gap-1.5 rounded-full border border-line bg-card/90 px-3 py-1.5 text-xs font-semibold text-title shadow-sm backdrop-blur-md transition-colors hover:border-brand-medium hover:bg-card focus-visible:outline-2 focus-visible:outline-brand-medium"
        >
          <span aria-hidden>↺</span>
          Vista general
        </button>
      )}
      <div className="hidden sm:block">
        <MapZoomControls onZoomIn={() => mapRef.current?.zoomIn()} onZoomOut={() => mapRef.current?.zoomOut()} />
      </div>
      <div className="tw-tower-legend" aria-label="Leyenda">
        <span data-state="ok">Completa</span>
        <span data-state="warn">Falta gente</span>
        <span data-state="danger">Con alerta</span>
      </div>
    </div>
  );
}