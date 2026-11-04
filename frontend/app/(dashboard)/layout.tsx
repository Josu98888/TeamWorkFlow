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
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--bg-main)' }}>
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Topbar />
        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
