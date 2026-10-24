import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { InvalidTokenException } from '../../common/exceptions/app.exceptions';
import type { AuthenticatedRequest } from '../authenticated-request';
import type { VerifiedActor } from '../../auth/verified-actor';

// The caller as the AuthGuard verified it. Controllers pass it to module
// operations next to the validated body; the body never carries an actor.
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): VerifiedActor => {
    const { actor } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Reaching a handler without an actor means the route is @Public() or the
    // guard is not registered: fail closed.
    if (!actor) throw new InvalidTokenException();
    return actor;
  },
);
