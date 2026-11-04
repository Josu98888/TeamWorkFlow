import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureNotInPlanException } from '../../common/exceptions/app.exceptions';
import { REQUIRES_FEATURE_KEY } from '../decorators/requires-feature.decorator';
import type { AuthenticatedRequest } from '../authenticated-request';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredFeature =
      this.reflector.getAllAndOverride<string | undefined>(
        REQUIRES_FEATURE_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!requiredFeature) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = request.actor;

    if (!actor || !actor.features || !actor.features[requiredFeature]) {
      throw new FeatureNotInPlanException();
    }

    return true;
  }
}
