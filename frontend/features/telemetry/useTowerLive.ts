'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { USE_MOCKS, WS_URL } from '@/shared/lib/config';
import type { SiteSummary } from './types';

const POLL_INTERVAL_MS = 15_000;

/**
 * Live feed of the Torre de Control: Socket.IO to the telemetry gateway (path `/ws`, default namespace),
 * authenticated by the `access_token` cookie of the handshake (`withCredentials`). Each
 * `site_summary_updated` event carries a `SiteSummary`. If the socket cannot connect (or drops), it falls
 * back to calling `onPoll` every 15 s until it reconnects. Disabled in mock mode.
 */
export function useTowerLive(onPoll: () => void, onUpdate: () => void) {
  const [summaries, setSummaries] = useState<Record<string, SiteSummary>>({});
  const [connected, setConnected] = useState(false);
  // Latest callbacks without retriggering the connection effect.
  const callbacks = useRef({ onPoll, onUpdate });
  useEffect(() => {
    callbacks.current = { onPoll, onUpdate };
  });

  useEffect(() => {
    if (USE_MOCKS) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const startPolling = () => {
      timer ??= setInterval(() => callbacks.current.onPoll(), POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };

    const socket = io(WS_URL, { path: '/ws', withCredentials: true, transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      setConnected(true);
      stopPolling();
    });
    socket.on('disconnect', () => {
      setConnected(false);
      startPolling();
    });
    socket.on('connect_error', () => {
      setConnected(false);
      startPolling();
    });
    socket.on('site_summary_updated', (summary: SiteSummary) => {
      setSummaries((current) => ({ ...current, [summary.siteId]: summary }));
      callbacks.current.onUpdate();
    });

    return () => {
      stopPolling();
      socket.disconnect();
    };
  }, []);

  return { summaries, connected };
}
