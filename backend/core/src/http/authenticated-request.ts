import type { Request } from 'express';
import type { VerifiedActor } from '../auth/verified-actor';

// Request after the AuthGuard: `actor` exists only on guarded routes and is
// built from the `auth.token.verify` result, never from client input.
export type AuthenticatedRequest = Request & { actor?: VerifiedActor };
