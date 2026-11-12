import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, TimeoutError, timeout } from 'rxjs';
import { envs } from '../config';
import { NATS_PATTERNS, NATS_SERVICE } from './nats.constants';
import {
  AppException,
  AppErrorCode,
  InvalidTokenException,
  UpstreamTimeoutException,
  UpstreamUnavailableException,
  ValidationErrorItem,
} from '../common/exceptions';
import type {
  EmployeeDto,
  Plan,
  Role,
  ShiftDto,
  SiteDto,
  TenantStatus,
  VerifiedActor,
} from './dto/nats-contracts';

const VALID_ROLES = new Set<Role>([
  'owner',
  'admin',
  'supervisor',
  'employee',
  'platform_admin',
]);
const DEFAULT_JWT_FALLBACK_TTL_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 2_000;

// Error body that core's NatsErrorFilter sends back; the Nest client rejects with it as is.
interface RemoteErrorBody {
  status: number;
  code: AppErrorCode;
  message: string;
  errors?: ValidationErrorItem[];
}

interface CachedTokenEntry {
  actor: VerifiedActor;
  cachedUntil: number;
  jwtExpMs: number;
}

function isRemoteErrorBody(value: unknown): value is RemoteErrorBody {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<RemoteErrorBody>;
  return (
    typeof body.status === 'number' &&
    body.status >= 400 &&
    typeof body.code === 'string' &&
    typeof body.message === 'string'
  );
}

function toAppException(body: RemoteErrorBody): AppException {
  return new AppException(body.status, body.code, body.message, body.errors);
}

function hashAccessToken(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}

export function verifyHs256JwtLocally(
  accessToken: string,
  secret: string,
): VerifiedActor | null {
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(
      Buffer.from(headerB64, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (header.alg !== 'HS256') {
    throw new InvalidTokenException();
  }

  const expectedSig = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signatureB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new InvalidTokenException();
  }

  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    throw new InvalidTokenException();
  }

  const sub = payload.sub;
  const role = payload.role;
  const tenantId = payload.tenantId;
  if (
    typeof sub !== 'string' ||
    sub.length === 0 ||
    typeof role !== 'string' ||
    !VALID_ROLES.has(role as Role) ||
    (role !== 'platform_admin' && (typeof tenantId !== 'string' || tenantId.length === 0))
  ) {
    throw new InvalidTokenException();
  }

  const siteIds = Array.isArray(payload.siteIds)
    ? payload.siteIds.filter((s): s is string => typeof s === 'string')
    : [];
  const features =
    payload.features && typeof payload.features === 'object'
      ? (payload.features as Record<string, boolean>)
      : {};

  return {
    userId: sub,
    tenantId: typeof tenantId === 'string' ? tenantId : '',
    role: role as Role,
    siteIds,
    tenantStatus: (payload.tenantStatus as TenantStatus) ?? 'active',
    plan: (payload.plan as Plan) ?? 'basic',
    features,
    ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}),
  };
}

@Injectable()
export class NatsClientService {
  private readonly logger = new Logger(NatsClientService.name);
  private readonly tokenCache = new Map<string, CachedTokenEntry>();

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  invalidateTenantCache(tenantId: string): void {
    for (const [key, entry] of this.tokenCache.entries()) {
      if (entry.actor.tenantId === tenantId) {
        this.tokenCache.delete(key);
      }
    }
  }

  clearTokenCache(): void {
    this.tokenCache.clear();
  }

  private cacheActor(
    cacheKey: string,
    actor: VerifiedActor,
    ttlMs: number,
  ): void {
    const now = Date.now();
    const jwtExpMs = actor.exp
      ? actor.exp * 1000
      : now + DEFAULT_JWT_FALLBACK_TTL_MS;
    if (jwtExpMs <= now) return;

    if (this.tokenCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.tokenCache.keys().next().value;
      if (oldestKey) {
        this.tokenCache.delete(oldestKey);
      }
    }

    this.tokenCache.set(cacheKey, {
      actor: { ...actor, features: { ...actor.features } },
      cachedUntil: Math.min(now + ttlMs, jwtExpMs),
      jwtExpMs,
    });
  }

  async request<TReq, TRes>(
    subject: string,
    data: TReq,
    timeoutMs?: number,
  ): Promise<TRes> {
    try {
      const response = await firstValueFrom(
        this.client
          .send<TRes, TReq>(subject, data)
          .pipe(timeout(timeoutMs ?? envs.natsTimeoutMs)),
      );

      // Defensive: a responder that returns an error body as a normal reply.
      if (isRemoteErrorBody(response)) {
        throw toAppException(response);
      }

      return response;
    } catch (error: unknown) {
      if (error instanceof AppException) {
        throw error;
      }
      if (isRemoteErrorBody(error)) {
        throw toAppException(error);
      }
      if (error instanceof TimeoutError) {
        throw new UpstreamTimeoutException(subject);
      }

      const err = error as { code?: string; name?: string; message?: string };
      const code = err?.code || err?.name;
      // With no responder the Nest client gets an empty reply (EmptyResponseException).
      if (
        code === 'NO_RESPONDERS' ||
        code === 'CONNECTION_REFUSED' ||
        code === 'EmptyResponseException' ||
        err?.message?.toLowerCase().includes('no responders')
      ) {
        throw new UpstreamUnavailableException(subject);
      }

      this.logger.error(
        `NATS request to ${subject} failed: ${err?.message ?? String(error)}`,
      );
      throw new UpstreamUnavailableException(subject);
    }
  }

  async verifyToken(
    accessToken: string,
    options?: { jwtSecret?: string; cacheTtlMs?: number },
  ): Promise<VerifiedActor> {
    const cacheKey = hashAccessToken(accessToken);
    const now = Date.now();
    const cached = this.tokenCache.get(cacheKey);
    if (cached && now < cached.cachedUntil && now < cached.jwtExpMs) {
      return { ...cached.actor, features: { ...cached.actor.features } };
    }

    const ttlMs = options?.cacheTtlMs ?? envs.authCacheTtlMs;

    try {
      const actor = await this.request<{ accessToken: string }, VerifiedActor>(
        NATS_PATTERNS.AUTH_TOKEN_VERIFY,
        { accessToken },
      );
      if (ttlMs > 0) {
        this.cacheActor(cacheKey, actor, ttlMs);
      }
      return actor;
    } catch (error: unknown) {
      if (
        error instanceof UpstreamUnavailableException ||
        error instanceof UpstreamTimeoutException
      ) {
        // 1. Stale-while-offline fallback if token was previously verified and JWT exp is still valid
        if (cached && now < cached.jwtExpMs) {
          this.logger.warn(
            'auth.token.verify upstream unavailable; serving recently verified actor within JWT expiry',
          );
          return { ...cached.actor, features: { ...cached.actor.features } };
        }

        // 2. Local HS256 JWT cryptographic fallback when JWT_SECRET is configured
        const secret = options?.jwtSecret ?? envs.jwtSecret;
        if (secret) {
          const localActor = verifyHs256JwtLocally(accessToken, secret);
          if (localActor) {
            this.logger.warn(
              'auth.token.verify upstream unavailable; verified JWT locally using JWT_SECRET',
            );
            if (ttlMs > 0) {
              this.cacheActor(cacheKey, localActor, ttlMs);
            }
            return localActor;
          }
        }
      }
      throw error;
    }
  }

  async getEmployee(tenantId: string, userId: string): Promise<EmployeeDto> {
    return this.request<{ tenantId: string; userId: string }, EmployeeDto>(
      NATS_PATTERNS.ORGANIZATION_EMPLOYEE_GET,
      { tenantId, userId },
    );
  }

  async getSite(tenantId: string, siteId: string): Promise<SiteDto> {
    return this.request<{ tenantId: string; siteId: string }, SiteDto>(
      NATS_PATTERNS.ORGANIZATION_SITE_GET,
      { tenantId, siteId },
    );
  }

  async getShift(tenantId: string, shiftId: string): Promise<ShiftDto> {
    return this.request<{ tenantId: string; shiftId: string }, ShiftDto>(
      NATS_PATTERNS.ORGANIZATION_SHIFT_GET,
      { tenantId, shiftId },
    );
  }
}
