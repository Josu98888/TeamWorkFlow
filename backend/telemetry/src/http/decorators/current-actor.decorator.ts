import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../authenticated-request';
import type { VerifiedActor } from '../../nats/dto/nats-contracts';

export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): VerifiedActor => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.actor) {
      throw new Error('CurrentActor used on route without AuthGuard');
    }
    return request.actor;
  },
);
