'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { USE_MOCKS, WS_URL } from '@/shared/lib/config';
import { fetchSocketToken } from './http';
import type { SiteSummary } from './types';

const POLL_INTERVAL_MS = 15_000;
// A server-initiated disconnect sooner than this after connecting is a rejected handshake, not the session cap.
const MIN_HEALTHY_SESSION_MS = 10_000;

/**
 * Live feed of the Torre de Control: Socket.IO to the telemetry gateway (path `/ws`, default namespace),
 * authenticated with a short-lived socket token fetched from core (`POST /auth/socket-token`) by the
 * Socket.IO `auth` callback, which runs on every (re)connect so each attempt carries a fresh token. Each
 * `site_summary_updated` event carries a `SiteSummary`. If the socket cannot connect (or drops), it falls
 * back to calling `onPoll` every 15 s until it reconnects. If the token cannot be obtained (no session, plan
 * without the tower) the socket stops and only the polling remains. The server closes the socket after 15 min;
 * Socket.IO does not retry a server-initiated disconnect, so it reconnects explicitly. Disabled in mock mode.
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

    let closed = false;
    let connectedAt = 0;
    const socket = io(WS_URL, {
      path: '/ws',
      transports: ['websocket', 'polling'],
      // Runs on every connection attempt, including automatic reconnects and `socket.connect()`.
      auth: (cb) => {
        fetchSocketToken().then(
          ({ token }) => {
            if (!closed) cb({ token });
          },
          () => {
            // No token (401/403 or network): no handshake and no retry; the polling keeps the view fresh.
            if (closed) return;
            socket.disconnect();
            setConnected(false);
            startPolling();
          },
        );
      },
    });
    socket.on('connect', () => {
      connectedAt = Date.now();
      setConnected(true);
      stopPolling();
    });
    socket.on('disconnect', (reason) => {
      setConnected(false);
      startPolling();
      // `io server disconnect` (session cap, rejected token) is never retried by Socket.IO. After a healthy
      // session, reconnect (runs `auth` again for a fresh token); right after connecting it was a rejection.
      if (reason === 'io server disconnect' && Date.now() - connectedAt >= MIN_HEALTHY_SESSION_MS) {
        socket.connect();
      }
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
      closed = true;
      stopPolling();
      socket.disconnect();
    };
  }, []);

  return { summaries, connected };
}
