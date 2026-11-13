'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { canAccessRoute, homeFor } from '@/shared/auth/permissions';
import { useSession } from '@/shared/hooks/useSession';

/**
 * Client-side re-check of the route rules with the (possibly refreshed) session; `proxy.ts` cannot
 * decide when the access token cookie already expired. Renders nothing while a redirect is pending.
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const denied = !!session && !canAccessRoute(session.role, pathname);

  useEffect(() => {
    if (denied && session) router.replace(homeFor(session.role));
  }, [denied, session, router]);

  return denied ? null : <>{children}</>;
}
