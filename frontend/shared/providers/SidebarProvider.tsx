'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'sidebar-collapsed';
const DESKTOP_QUERY = '(min-width: 1024px)';
const TABLET_QUERY = '(min-width: 640px)';

/** desktop >= 1024px, tablet 640-1023px, mobile < 640px. */
export type SidebarMode = 'desktop' | 'tablet' | 'mobile';

type SidebarContextValue = {
  mode: SidebarMode;
  /** Labels are visible: full sidebar on desktop, or the tablet/mobile overlay. False in the icon-only rail. */
  isOpen: boolean;
  /** Tablet or mobile overlay is showing (backdrop, Escape and navigation close it). */
  isOverlay: boolean;
  toggle: () => void;
  close: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

// Desktop preference store (true = icon-only rail). localStorage may be unavailable (private mode,
// blocked site data), so every access is guarded and an in-memory value is the fallback.
let memoryCollapsed = false;
const listeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === '1';
  } catch {
    // Ignore: fall back to the in-memory value.
  }
  return memoryCollapsed;
}

function writeCollapsed(collapsed: boolean) {
  memoryCollapsed = collapsed;
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Ignore: the in-memory value still applies for this session.
  }
  listeners.forEach((notify) => notify());
}

function subscribeCollapsed(notify: () => void) {
  listeners.add(notify);
  window.addEventListener('storage', notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', notify);
  };
}

function subscribeMode(notify: () => void) {
  const queries = [window.matchMedia(DESKTOP_QUERY), window.matchMedia(TABLET_QUERY)];
  queries.forEach((query) => query.addEventListener('change', notify));
  return () => queries.forEach((query) => query.removeEventListener('change', notify));
}

function getMode(): SidebarMode {
  if (window.matchMedia(DESKTOP_QUERY).matches) return 'desktop';
  return window.matchMedia(TABLET_QUERY).matches ? 'tablet' : 'mobile';
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);

  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const mode = useSyncExternalStore<SidebarMode>(subscribeMode, getMode, () => 'desktop');
  const [lastMode, setLastMode] = useState(mode);

  // Close the overlay on navigation or when the viewport changes class (adjust state during render).
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOverlayOpen(false);
  }
  if (mode !== lastMode) {
    setLastMode(mode);
    setOverlayOpen(false);
  }

  const isOverlay = mode !== 'desktop' && overlayOpen;

  useEffect(() => {
    if (!isOverlay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverlayOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOverlay]);

  const toggle = () => {
    if (mode === 'desktop') writeCollapsed(!collapsed);
    else setOverlayOpen(!overlayOpen);
  };

  const value: SidebarContextValue = {
    mode,
    isOpen: mode === 'desktop' ? !collapsed : overlayOpen,
    isOverlay,
    toggle,
    close: () => setOverlayOpen(false),
  };

  return <SidebarContext value={value}>{children}</SidebarContext>;
}

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used inside <SidebarProvider>');
  return context;
}
