import type { VerifiedActor } from './verified-actor';
import type { WireRole } from './wire';

// The actor fields the admin operations of `auth` document. Built from the
// verified result only; plan, features and site scope never reach services.
export interface ServiceActor {
  userId: string;
  tenantId: string | null;
  role: WireRole;
}

export function toServiceActor(actor: VerifiedActor): ServiceActor {
  return { userId: actor.userId, tenantId: actor.tenantId, role: actor.role };
}
