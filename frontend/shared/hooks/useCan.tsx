'use client';

import type { ReactNode } from 'react';
import { can, type Capability } from '@/shared/auth/permissions';
import { useSession } from './useSession';

/** `(capability) => boolean` for the current session; false while the session is loading or absent. */
export function useCan() {
  const session = useSession();
  return (capability: Capability) => can(session?.role, capability);
}

/** Renders `children` only when the current role holds `capability`. */
export function Can({ capability, children, fallback = null }: { capability: Capability; children: ReactNode; fallback?: ReactNode }) {
  const allowed = useCan()(capability);
  return <>{allowed ? children : fallback}</>;
}
