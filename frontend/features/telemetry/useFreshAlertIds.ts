'use client';

import { useEffect, useRef, useState } from 'react';
import type { Alert } from './types';

const FRESH_MS = 8_000;

/** Ids of alerts that arrived after the first load, kept for a few seconds so the feed can highlight them. */
export function useFreshAlertIds(alerts: readonly Alert[] | undefined): ReadonlySet<string> {
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!alerts) return;
    if (known.current === null) {
      known.current = new Set(alerts.map((alert) => alert.id));
      return;
    }
    const seen = known.current;
    const arrived = alerts.filter((alert) => !seen.has(alert.id)).map((alert) => alert.id);
    if (arrived.length === 0) return;
    arrived.forEach((id) => seen.add(id));
    setFresh((current) => new Set([...current, ...arrived]));
    const timer = setTimeout(() => setFresh((current) => new Set([...current].filter((id) => !arrived.includes(id)))), FRESH_MS);
    return () => clearTimeout(timer);
  }, [alerts]);

  return fresh;
}
