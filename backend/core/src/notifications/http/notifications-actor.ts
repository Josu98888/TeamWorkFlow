import type { VerifiedActor } from '../../auth/verified-actor';
import { ForbiddenException } from '../../common/exceptions/app.exceptions';
import type { NotificationActor } from '../push-tokens/push-tokens.service';

export function toNotificationActor(actor: VerifiedActor): NotificationActor {
  if (!actor.tenantId || actor.role === 'platform_admin') {
    throw new ForbiddenException();
  }
  return {
    tenantId: actor.tenantId,
    userId: actor.userId,
    role: actor.role,
  };
}
