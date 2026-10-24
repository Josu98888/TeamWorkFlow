import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthService } from '../../auth/auth.service';
import type { VerifiedActor } from '../../auth/verified-actor';
import {
  InvalidTokenException,
  TenantSuspendedException,
} from '../../common/exceptions/app.exceptions';
import type { AuthenticatedRequest } from '../authenticated-request';
import { CurrentActor } from '../decorators/current-actor.decorator';
import { Public } from '../decorators/public.decorator';
import { AuthGuard } from './auth.guard';

jest.mock('../../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// Only the class shape of the generated client is needed.
jest.mock('../../auth/prisma/generated/client', () => ({
  PrismaClient: class {},
}));

const ACTOR: VerifiedActor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-000000000002',
  role: 'admin',
  tenantStatus: 'active',
  plan: 'basic',
  features: null,
};

class Plain {
  handler() {}
}
class PublicRoute {
  @Public()
  handler() {}
}

function contextFor(
  route: { prototype: { handler: () => void } },
  request: Partial<AuthenticatedRequest>,
): ExecutionContext {
  return {
    getHandler: () => route.prototype.handler,
    getClass: () => route,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const verify = jest.fn();
  const guard = new AuthGuard(
    { verify } as unknown as AuthService,
    new Reflector(),
  );

  beforeEach(() => jest.clearAllMocks());

  it('lets @Public() routes through without verifying', async () => {
    await expect(guard.canActivate(contextFor(PublicRoute, {}))).resolves.toBe(
      true,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([
    ['no header', undefined],
    ['a non-bearer scheme', 'Basic abc'],
    ['an empty bearer token', 'Bearer '],
    ['extra parts', 'Bearer a b'],
  ])('answers invalid_token for %s', async (_label, authorization) => {
    const request = { headers: { authorization } };

    await expect(
      guard.canActivate(contextFor(Plain, request as never)),
    ).rejects.toBeInstanceOf(InvalidTokenException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('attaches the actor from the verify result only', async () => {
    verify.mockResolvedValue(ACTOR);
    // The body and headers claim another tenant and role: they are ignored.
    const request = {
      headers: { authorization: 'Bearer tok', 'x-tenant-id': 'evil' },
      body: { tenantId: 'evil', role: 'owner' },
    } as unknown as AuthenticatedRequest;

    await expect(guard.canActivate(contextFor(Plain, request))).resolves.toBe(
      true,
    );

    expect(verify).toHaveBeenCalledWith({ accessToken: 'tok' });
    expect(request.actor).toBe(ACTOR);
  });

  it('propagates domain errors from verify unchanged', async () => {
    verify.mockRejectedValue(new TenantSuspendedException());
    const request = { headers: { authorization: 'Bearer tok' } };

    await expect(
      guard.canActivate(contextFor(Plain, request as never)),
    ).rejects.toBeInstanceOf(TenantSuspendedException);
  });
});

describe('CurrentActor', () => {
  // Param decorators keep their factory in the class metadata.
  class Handler {
    handler(@CurrentActor() _actor: VerifiedActor) {}
  }
  const metadata = Reflect.getMetadata(
    '__routeArguments__',
    Handler,
    'handler',
  ) as Record<string, { factory: (data: unknown, ctx: unknown) => unknown }>;
  const { factory } = Object.values(metadata)[0];
  const contextWith = (request: object) => ({
    switchToHttp: () => ({ getRequest: () => request }),
  });

  it('returns request.actor', () => {
    expect(factory(undefined, contextWith({ actor: ACTOR }))).toBe(ACTOR);
  });

  it('fails closed when the guard did not set an actor', () => {
    expect(() => factory(undefined, contextWith({}))).toThrow(
      InvalidTokenException,
    );
  });
});
