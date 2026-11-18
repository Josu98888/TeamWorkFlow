'use client';

import { createContext, useContext, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'sidebar-hidden';
const DESKTOP_QUERY = '(min-width: 1024px)';

type SidebarContextValue = {
  /** True when the viewport is at least `lg` (sidebar is a static column). */
  isDesktop: boolean;
  /** Whether the sidebar is currently visible for the active viewport. */
  isOpen: boolean;
  toggle: () => void;
  closeMobile: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

// Desktop preference store. localStorage may be unavailable (private mode, blocked
// site data), so every access is guarded and an in-memory value is the fallback.
let memoryHidden = false;
const listeners = new Set<() => void>();

function readHidden(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === '1';
  } catch {
    // Ignore: fall back to the in-memory value.
  }
  return memoryHidden;
}

function writeHidden(hidden: boolean) {
  memoryHidden = hidden;
  try {
    localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0');
  } catch {
    // Ignore: the in-memory value still applies for this session.
  }
  listeners.forEach((notify) => notify());
}

function subscribeHidden(notify: () => void) {
  listeners.add(notify);
  window.addEventListener('storage', notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', notify);
  };
}

function subscribeDesktop(notify: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);

  const desktopHidden = useSyncExternalStore(subscribeHidden, readHidden, () => false);
  const isDesktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );

  // Close the drawer on navigation (adjust state during render, no effect needed).
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  const toggle = () => {
    if (isDesktop) writeHidden(!desktopHidden);
    else setMobileOpen(!mobileOpen);
  };

  const value: SidebarContextValue = {
    isDesktop,
    isOpen: isDesktop ? !desktopHidden : mobileOpen,
    toggle,
    closeMobile: () => setMobileOpen(false),
  };

  return <SidebarContext value={value}>{children}</SidebarContext>;
}

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used inside <SidebarProvider>');
  return context;
}
