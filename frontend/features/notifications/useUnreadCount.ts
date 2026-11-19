'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/shared/lib/http';
import { notificationsApi } from './api';
import { NOTIFICATIONS_CHANGED_EVENT } from './events';

/** How often the unread badge is refreshed while the app is open. */
const POLL_INTERVAL_MS = 60_000;

/** Unread count, polled on an interval and refreshed on demand (`refresh`) or when a mutation is announced. */
export function useUnreadCount() {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      // Skip background polls; the next visible tick (or an explicit refresh) catches up.
      if (document.hidden) return;
      notificationsApi
        .getUnreadCount()
        .then((value) => {
          if (!cancelled) setCount(value);
        })
        .catch((error: unknown) => {
          // Session gone: stop polling instead of retrying auth every minute.
          if (error instanceof ApiError && error.status === 401) clearInterval(timer);
          // Otherwise keep the last known count; the next poll retries.
        });
    };
    // Created before the first load so its async catch can always clear it.
    const timer = setInterval(load, POLL_INTERVAL_MS);
    load();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
  }, [refresh]);

  return { count, refresh };
}
