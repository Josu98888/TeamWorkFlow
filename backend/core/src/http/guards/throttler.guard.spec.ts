import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { RateLimitedException } from '../../common/exceptions/app.exceptions';
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

describe('AppThrottlerGuard (core)', () => {
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
    const req1 = { ip: '10.0.0.1', headers: {}, actor: { userId: 'u-1' } };
    const req2 = { ip: '10.0.0.2', headers: {}, actor: { userId: 'u-1' } };
    const otherUser = { ip: '10.0.0.1', headers: {}, actor: { userId: 'u-2' } };

    await expect(guard.canActivate(makeHttpContext(req1))).resolves.toBe(true);
    await expect(guard.canActivate(makeHttpContext(req2))).resolves.toBe(true);
    await expect(
      guard.canActivate(makeHttpContext(req1)),
    ).rejects.toBeInstanceOf(RateLimitedException);

    // A different authenticated user on the same IP has their own bucket
    await expect(guard.canActivate(makeHttpContext(otherUser))).resolves.toBe(
      true,
    );
  });

  it('tracks public requests by client IP and throws RateLimitedException over the limit', async () => {
    const ipA = { ip: '203.0.113.10', headers: {} };
    const ipB = { ip: '203.0.113.20', headers: {} };

    await expect(guard.canActivate(makeHttpContext(ipA))).resolves.toBe(true);
    await expect(guard.canActivate(makeHttpContext(ipA))).resolves.toBe(true);

    try {
      await guard.canActivate(makeHttpContext(ipA));
      throw new Error('Expected RateLimitedException');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitedException);
      expect((err as RateLimitedException).getError()).toEqual({
        status: 429,
        code: 'rate_limited',
        message: 'Too many requests, please try again later',
      });
    }

    // Another client IP is not affected
    await expect(guard.canActivate(makeHttpContext(ipB))).resolves.toBe(true);
  });

  it('skips non-HTTP execution contexts (NATS responders)', async () => {
    const rpcContext = {
      getType: () => 'rpc',
      getClass: () => TestHandler,
      getHandler: () => TestHandler.prototype.constructor,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(rpcContext)).resolves.toBe(true);
  });
});
