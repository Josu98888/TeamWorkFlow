import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  FeatureNotInPlanException,
  ForbiddenException,
  InvalidTokenException,
  TenantCancelledException,
  TenantSuspendedException,
} from '../common/exceptions/app.exceptions';
import { envs } from '../config';
import { AuthGuard } from '../http/guards/auth.guard';
import type { AuthenticatedRequest } from '../http/authenticated-request';
import { AuthService } from './auth.service';
import { JetStreamService } from './events/jetstream.service';
import { PrismaService } from './prisma/prisma.service';
import { TokenService } from './token.service';
import type { VerifiedActor } from './verified-actor';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// Only the class shape of the generated client is needed.
jest.mock('./prisma/generated/client', () => ({ PrismaClient: class {} }));

const NOW = new Date('2026-10-12T10:00:00.000Z');
const USER_ID = '0199b7e0-0000-7000-8000-000000000001';
const TENANT_ID = '0199b7e0-0000-7000-8000-000000000002';

function actor(overrides: Partial<VerifiedActor> = {}): VerifiedActor {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: 'owner',
    tenantStatus: 'active',
    plan: 'pro',
    features: { tasks: true, alerts: true, tower: true },
    ...overrides,
  };
}

// Core side of the Tower WebSocket handshake: who may get a socket token and
// why it can never stand in for an access token.
describe('AuthService.issueSocketToken', () => {
  let service: AuthService;
  let jwt: JwtService;
  const findUnique = jest.fn();

  beforeEach(async () => {
    // Fake only Date: jsonwebtoken needs real timers/ticks.
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    findUnique.mockReset().mockResolvedValue({
      id: USER_ID,
      tenantId: TENANT_ID,
      role: 'OWNER',
      isActive: true,
      siteIds: [],
      tenant: { status: 'ACTIVE', plan: 'PRO', features: { tower: true } },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: envs.jwtSecret,
          signOptions: { algorithm: 'HS256' },
        }),
      ],
      providers: [
        AuthService,
        TokenService,
        { provide: PrismaService, useValue: { user: { findUnique } } },
        { provide: JetStreamService, useValue: { publish: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['owner', 'admin', 'supervisor'] as const)(
    'issues a 60 second socket token to a %s',
    async (role) => {
      const result = await service.issueSocketToken(actor({ role }));

      expect(result.expiresIn).toBe(60);
      const claims = jwt.decode<Record<string, unknown>>(result.token);
      expect(claims).toMatchObject({
        sub: USER_ID,
        tenantId: TENANT_ID,
        role,
        typ: 'socket',
      });
      expect((claims.exp as number) - (claims.iat as number)).toBe(60);
    },
  );

  it('refuses an employee', async () => {
    await expect(
      service.issueSocketToken(actor({ role: 'employee' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a platform_admin', async () => {
    await expect(
      service.issueSocketToken(
        actor({
          role: 'platform_admin',
          tenantId: null,
          tenantStatus: null,
          features: null,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an actor without a tenant even with an allowed role', async () => {
    await expect(
      service.issueSocketToken(actor({ tenantId: null })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['no features', null],
    ['a plan without tower', { tasks: true, alerts: true, tower: false }],
    ['features that omit tower', { tasks: true }],
  ])('refuses a tenant with %s', async (_label, features) => {
    await expect(
      service.issueSocketToken(actor({ features })),
    ).rejects.toBeInstanceOf(FeatureNotInPlanException);
  });

  it('refuses a suspended tenant even for the owner', async () => {
    await expect(
      service.issueSocketToken(actor({ tenantStatus: 'suspended' })),
    ).rejects.toBeInstanceOf(TenantSuspendedException);
  });

  it('refuses a cancelled tenant even for the owner', async () => {
    await expect(
      service.issueSocketToken(actor({ tenantStatus: 'cancelled' })),
    ).rejects.toBeInstanceOf(TenantCancelledException);
  });

  it('allows a past_due tenant', async () => {
    await expect(
      service.issueSocketToken(actor({ tenantStatus: 'past_due' })),
    ).resolves.toMatchObject({ expiresIn: 60 });
  });

  it('does not copy site ids, plan or features into the token', async () => {
    const result = await service.issueSocketToken(
      actor({ role: 'supervisor', siteIds: ['site-a'] }),
    );

    const claims = jwt.decode<Record<string, unknown>>(result.token);
    expect(claims).not.toHaveProperty('siteIds');
    expect(claims).not.toHaveProperty('features');
    expect(claims).not.toHaveProperty('plan');
  });

  it('the issued token cannot authenticate an HTTP request through the AuthGuard', async () => {
    const { token } = await service.issueSocketToken(actor());
    const guard = new AuthGuard(service, new Reflector());
    class Route {
      handler() {}
    }
    const request = {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    } as unknown as AuthenticatedRequest;
    const context = {
      getHandler: () => Route.prototype.handler,
      getClass: () => Route,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const error = await guard.canActivate(context).then(
      () => {
        throw new Error('Expected the guard to reject the socket token');
      },
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(InvalidTokenException);
    expect((error as InvalidTokenException).getError()).toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
    expect(request.actor).toBeUndefined();
  });

  it('is accepted by verify only with the socket purpose', async () => {
    const { token } = await service.issueSocketToken(actor());

    await expect(service.verify({ accessToken: token })).rejects.toBeInstanceOf(
      InvalidTokenException,
    );
    await expect(
      service.verify({ accessToken: token, purpose: 'socket' }),
    ).resolves.toMatchObject({ userId: USER_ID, role: 'owner' });
  });
});
