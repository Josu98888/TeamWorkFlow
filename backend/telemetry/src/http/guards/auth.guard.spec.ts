import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { NatsClientService } from '../../nats/nats-client.service';
import {
  CsrfInvalidException,
  FeatureNotInPlanException,
  ForbiddenException,
  InvalidTokenException,
  TenantCancelledException,
  TenantSuspendedException,
} from '../../common/exceptions';
import type { VerifiedActor } from '../../nats/dto/nats-contracts';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let mockNatsClient: { verifyToken: jest.Mock };
  let mockReflector: { getAllAndOverride: jest.Mock };

  const validActor: VerifiedActor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'supervisor',
    siteIds: ['site-1'],
    tenantStatus: 'active',
    plan: 'pro',
    features: { alerts: true, tower: true },
  };

  const createMockContext = (headers: Record<string, string>, method = 'GET'): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          method,
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    mockNatsClient = { verifyToken: jest.fn() };
    mockReflector = { getAllAndOverride: jest.fn() };
    guard = new AuthGuard(
      mockNatsClient as unknown as NatsClientService,
      mockReflector as unknown as Reflector,
    );
  });

  it('throws InvalidTokenException when no token is present', async () => {
    const ctx = createMockContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(InvalidTokenException);
  });

  it('verifies Bearer token and attaches actor to request', async () => {
    mockNatsClient.verifyToken.mockResolvedValueOnce(validActor);
    const ctx = createMockContext({ authorization: 'Bearer test-token' });

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockNatsClient.verifyToken).toHaveBeenCalledWith('test-token');
  });

  it('enforces CSRF token on mutating cookie-authenticated request', async () => {
    const ctx = createMockContext(
      {
        cookie: 'access_token=cookie-token; csrf_token=secret123',
        'x-csrf-token': 'wrong-token',
      },
      'POST',
    );

    await expect(guard.canActivate(ctx)).rejects.toThrow(CsrfInvalidException);
  });

  it('refuses platform_admin actor on telemetry routes', async () => {
    mockNatsClient.verifyToken.mockResolvedValueOnce({
      ...validActor,
      role: 'platform_admin',
    });
    const ctx = createMockContext({ authorization: 'Bearer test-token' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('refuses suspended and cancelled tenants', async () => {
    mockNatsClient.verifyToken.mockResolvedValueOnce({
      ...validActor,
      tenantStatus: 'suspended',
    });
    const ctx = createMockContext({ authorization: 'Bearer test-token' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(TenantSuspendedException);

    mockNatsClient.verifyToken.mockResolvedValueOnce({
      ...validActor,
      tenantStatus: 'cancelled',
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(TenantCancelledException);
  });

  it('enforces @Roles decorator', async () => {
    mockNatsClient.verifyToken.mockResolvedValueOnce({
      ...validActor,
      role: 'employee',
    });
    mockReflector.getAllAndOverride.mockReturnValueOnce(['supervisor', 'admin']);
    const ctx = createMockContext({ authorization: 'Bearer test-token' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('enforces @RequireFeature decorator', async () => {
    mockNatsClient.verifyToken.mockResolvedValueOnce({
      ...validActor,
      features: { alerts: false },
    });
    // First call roles -> undefined, second call features -> 'alerts'
    mockReflector.getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('alerts');

    const ctx = createMockContext({ authorization: 'Bearer test-token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(FeatureNotInPlanException);
  });
});
