import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CsrfInvalidException,
  FeatureNotInPlanException,
  ForbiddenException,
  InvalidTokenException,
  TenantCancelledException,
  TenantSuspendedException,
} from '../../common/exceptions';
import { NatsClientService } from '../../nats/nats-client.service';
import type { Role } from '../../nats/dto/nats-contracts';
import type { AuthenticatedRequest } from '../authenticated-request';
import { REQUIRE_FEATURE_KEY } from '../decorators/features.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
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

function extractBearerToken(header: string | undefined): string | undefined {
  const [type, token, ...rest] = header?.split(' ') ?? [];
  return type === 'Bearer' && token && rest.length === 0 ? token : undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly natsClient: NatsClientService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 1. Extract token (bearer takes precedence for mobile, cookie for web)
    const bearerToken = extractBearerToken(request.headers.authorization);
    const cookies = parseCookies(request.headers.cookie);
    const cookieToken = cookies['access_token'];

    const token = bearerToken ?? cookieToken;
    if (!token) {
      throw new InvalidTokenException();
    }

    // 2. CSRF check for cookie-authenticated mutating requests
    if (!bearerToken && cookieToken && MUTATING_METHODS.has(request.method.toUpperCase())) {
      const csrfHeader = request.headers['x-csrf-token'];
      const csrfCookie = cookies['csrf_token'];
      const headerVal = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

      if (!headerVal || !csrfCookie || !safeCompare(headerVal, csrfCookie)) {
        throw new CsrfInvalidException();
      }
    }

    // 3. Verify token with core via NATS
    const actor = await this.natsClient.verifyToken(token);

    // 4. Refuse platform_admin on every telemetry route
    if (actor.role === 'platform_admin') {
      throw new ForbiddenException('Platform admin access is not allowed on telemetry routes');
    }

    // 5. Tenant status check
    if (actor.tenantStatus === 'suspended') {
      throw new TenantSuspendedException();
    }
    if (actor.tenantStatus === 'cancelled') {
      throw new TenantCancelledException();
    }

    // 6. Role check
    const allowedRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowedRoles && !allowedRoles.includes(actor.role)) {
      throw new ForbiddenException();
    }

    // 7. Plan gating check
    const requiredFeature = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredFeature && !actor.features?.[requiredFeature]) {
      throw new FeatureNotInPlanException(requiredFeature);
    }

    request.actor = actor;
    return true;
  }
}
