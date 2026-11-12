import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../auth/auth.service';
import {
  AppErrorCode,
  AppException,
  InvalidTokenException,
} from '../../common/exceptions/app.exceptions';
import type { AuthenticatedRequest } from '../authenticated-request';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class CsrfInvalidException extends AppException {
  constructor() {
    super(403, 'csrf_invalid' as AppErrorCode, 'Invalid or missing CSRF token');
  }
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [name, ...val] = pair.trim().split('=');
    if (name) {
      cookies[name] = decodeURIComponent(val.join('='));
    }
  }
  return cookies;
}

// Global guard: runs `auth.token.verify` (an in-process facade call) on every
// route that is not @Public() and attaches the verified actor to the request.
// Supports both `Authorization: Bearer` (mobile) and `access_token` httpOnly
// cookie + double-submit `X-CSRF-Token` (web).
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
    const bearerToken = extractBearerToken(request.headers.authorization);
    const cookies = parseCookies(request.headers.cookie);
    const cookieToken = cookies['access_token'];

    const accessToken = bearerToken ?? cookieToken;
    if (!accessToken) throw new InvalidTokenException();

    // Enforce double-submit CSRF protection on cookie-authenticated state-changing requests
    const method = (request.method ?? 'GET').toUpperCase();
    if (!bearerToken && cookieToken && MUTATING_METHODS.has(method)) {
      const csrfHeader = request.headers['x-csrf-token'];
      const csrfCookie = cookies['csrf_token'];
      const headerVal = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

      if (!headerVal || !csrfCookie || !safeCompare(headerVal, csrfCookie)) {
        throw new CsrfInvalidException();
      }
    }

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
