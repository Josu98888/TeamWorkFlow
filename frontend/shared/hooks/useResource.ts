'use client';

import { useCallback, useEffect, useState } from 'react';

type Settled<T> = { argKey: string | undefined; attempt: number; data?: T; error?: Error };

/**
 * Loads a resource from a data-layer function.
 * `load` MUST be a stable reference (a module-level api function). `arg` is compared by value
 * (JSON), so passing an inline object such as `{ siteId }` does not retrigger the load.
 * Loading is derived (no synchronous setState in the effect); `reload` re-runs the load.
 */
export function useResource<T, A = void>(load: (arg: A) => Promise<T>, arg?: A) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const argKey = arg === undefined ? undefined : JSON.stringify(arg);

  useEffect(() => {
    let cancelled = false;
    const parsed = (argKey === undefined ? undefined : JSON.parse(argKey)) as A;
    load(parsed)
      .then((data) => {
        if (!cancelled) setSettled({ argKey, attempt, data });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSettled({ argKey, attempt, error: cause instanceof Error ? cause : new Error(String(cause)) });
      });
    return () => {
      cancelled = true;
    };
  }, [load, argKey, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const current = settled && settled.argKey === argKey && settled.attempt === attempt ? settled : null;

  return {
    data: current?.data,
    error: current?.error,
    isLoading: current === null,
    reload,
  };
}
