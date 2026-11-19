import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RateLimitedException } from '../../common/exceptions';
import type { AuthenticatedRequest } from '../authenticated-request';

// Global HTTP rate-limiting guard. Runs after `AuthGuard`: authenticated
// requests are tracked per `userId`, and public requests are tracked per client
// IP (`req.ip`, resolved through Express `trust proxy`).
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(
    context: ExecutionContext,
  ): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.shouldSkip(context);
  }

  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const actor = (req as Partial<AuthenticatedRequest>).actor;
    if (actor?.userId) {
      return `user:${actor.userId}`;
    }
    return super.getTracker(req);
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw new RateLimitedException();
  }
}
