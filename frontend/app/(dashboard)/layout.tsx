'use client';

import React, { useEffect, useState } from 'react';
import { Sidebar } from '../../components/layout/Sidebar';
import { Topbar } from '../../components/layout/Topbar';
import {
  clearLegacyTokenStorage,
  hasActiveSession,
  refreshAccessToken,
  scheduleProactiveRefresh,
  stopProactiveRefresh,
} from '../../shared/lib/http';

import { SidebarProvider } from '../../shared/providers/SidebarProvider';
import { RouteGuard } from '../../components/layout/RouteGuard';
import '../../components/layout/shell.css';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    let active = true;
    clearLegacyTokenStorage();

    async function verifyOrRefreshSession() {
      if (hasActiveSession()) {
        scheduleProactiveRefresh();
        if (active) setIsAuthorized(true);
        return;
      }

      const refreshed = await refreshAccessToken();
      if (!active) return;
      if (refreshed) {
        setIsAuthorized(true);
      } else {
        window.location.href = '/login';
      }
    }

    void verifyOrRefreshSession();

    return () => {
      active = false;
      stopProactiveRefresh();
    };
  }, []);

  if (!isAuthorized) {
    return null;
  }

  return (
    <SidebarProvider>
      <div className="app-shell">
        <Sidebar />
        <div className="app-card">
          <Topbar />
          <main className="flex-1 p-6 overflow-y-auto"><RouteGuard>{children}</RouteGuard></main>
        </div>
      </div>
    </SidebarProvider>
  );
}