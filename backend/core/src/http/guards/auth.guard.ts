import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../auth/auth.service';
import { InvalidTokenException } from '../../common/exceptions/app.exceptions';
import type { AuthenticatedRequest } from '../authenticated-request';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Global guard: runs `auth.token.verify` (an in-process facade call) on every
// route that is not @Public() and attaches the verified actor to the request.
// The result is never cached: deactivation and suspension apply immediately.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessToken = extractBearerToken(request.headers.authorization);
    if (!accessToken) throw new InvalidTokenException();

    // AppExceptions from verify (invalid_token, tenant_suspended, ...) reach
    // the HTTP filter unchanged; anything else is a real failure (500).
    request.actor = await this.auth.verify({ accessToken });
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  const [type, token, ...rest] = header?.split(' ') ?? [];
  return type === 'Bearer' && token && rest.length === 0 ? token : undefined;
}
