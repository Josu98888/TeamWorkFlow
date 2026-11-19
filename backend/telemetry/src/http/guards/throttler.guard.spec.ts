import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { RateLimitedException } from '../../common/exceptions';
import { AppThrottlerGuard } from './throttler.guard';

class TestHandler {}

function makeHttpContext(req: Record<string, unknown>): ExecutionContext {
  const res = {
    header: jest.fn(),
    setHeader: jest.fn(),
  };
  return {
    getType: () => 'http',
    getClass: () => TestHandler,
    getHandler: () => TestHandler.prototype.constructor,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('AppThrottlerGuard (telemetry)', () => {
  let guard: AppThrottlerGuard;
  let storage: ThrottlerStorageService;

  beforeEach(async () => {
    storage = new ThrottlerStorageService();
    guard = new AppThrottlerGuard(
      [{ name: 'default', ttl: 60_000, limit: 2 }],
      storage,
      new Reflector(),
    );
    await guard.onModuleInit();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
  });

  it('tracks authenticated requests by actor userId regardless of IP', async () => {
    const req1 = { ip: '10.0.0.1', headers: {}, actor: { userId: 'emp-1' } };
    const req2 = { ip: '10.0.0.2', headers: {}, actor: { userId: 'emp-1' } };
    const otherEmp = {
      ip: '10.0.0.1',
      headers: {},
      actor: { userId: 'emp-2' },
    };

    await expect(guard.canActivate(makeHttpContext(req1))).resolves.toBe(true);
    await expect(guard.canActivate(makeHttpContext(req2))).resolves.toBe(true);
    await expect(
      guard.canActivate(makeHttpContext(req1)),
    ).rejects.toBeInstanceOf(RateLimitedException);

    // Another employee on the same IP has their own bucket
    await expect(guard.canActivate(makeHttpContext(otherEmp))).resolves.toBe(
      true,
    );
  });

  it('falls back to client IP when no actor is present and throws RateLimitedException', async () => {
    const ipA = { ip: '203.0.113.10', headers: {} };
    const ipB = { ip: '203.0.113.20', headers: {} };

    await expect(guard.canActivate(makeHttpContext(ipA))).resolves.toBe(true);
    await expect(guard.canActivate(makeHttpContext(ipA))).resolves.toBe(true);
    await expect(
      guard.canActivate(makeHttpContext(ipA)),
    ).rejects.toBeInstanceOf(RateLimitedException);

    await expect(guard.canActivate(makeHttpContext(ipB))).resolves.toBe(true);
  });

  it('skips non-HTTP execution contexts (WebSocket / NATS)', async () => {
    const wsContext = {
      getType: () => 'ws',
      getClass: () => TestHandler,
      getHandler: () => TestHandler.prototype.constructor,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(wsContext)).resolves.toBe(true);
  });
});
