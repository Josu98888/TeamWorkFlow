import { createHmac } from 'node:crypto';
import { of, throwError, NEVER } from 'rxjs';
import { NatsClientService } from './nats-client.service';
import { NATS_PATTERNS } from './nats.constants';
import {
  AppException,
  InvalidTokenException,
  UpstreamTimeoutException,
  UpstreamUnavailableException,
} from '../common/exceptions';

function signTestHs256Jwt(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const headerB64 = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigB64 = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

describe('NatsClientService', () => {
  const client = { send: jest.fn() };
  let service: NatsClientService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NatsClientService(client as never);
  });

  it('returns the payload of the reply', async () => {
    const actor = {
      userId: 'user-123',
      tenantId: 'tenant-123',
      role: 'employee',
    };
    client.send.mockReturnValueOnce(of(actor));

    await expect(service.verifyToken('valid-token')).resolves.toEqual(actor);
  });

  it('serves repeated verifyToken calls from short-TTL cache and invalidates by tenantId', async () => {
    const actor = {
      userId: 'user-123',
      tenantId: 'tenant-123',
      role: 'employee' as const,
      siteIds: [],
      tenantStatus: 'active' as const,
      plan: 'basic' as const,
      features: {},
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    client.send.mockReturnValue(of(actor));

    await service.verifyToken('cached-token', { cacheTtlMs: 5000 });
    await service.verifyToken('cached-token', { cacheTtlMs: 5000 });
    expect(client.send).toHaveBeenCalledTimes(1);

    service.invalidateTenantCache('tenant-123');
    await service.verifyToken('cached-token', { cacheTtlMs: 5000 });
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('falls back to local HS256 JWT verification when core NATS is unavailable', async () => {
    const secret = 'super-secret-jwt-key-for-testing-1234';
    const jwt = signTestHs256Jwt(
      {
        sub: 'user-emp-1',
        tenantId: 'tenant-1',
        role: 'employee',
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      secret,
    );

    const err = new Error('No responders');
    err.name = 'EmptyResponseException';
    client.send.mockReturnValueOnce(throwError(() => err));

    const actor = await service.verifyToken(jwt, { jwtSecret: secret });
    expect(actor).toMatchObject({
      userId: 'user-emp-1',
      tenantId: 'tenant-1',
      role: 'employee',
      tenantStatus: 'active',
    });
  });

  it('rejects tampered or expired JWT during local fallback', async () => {
    const secret = 'super-secret-jwt-key-for-testing-1234';
    const expiredJwt = signTestHs256Jwt(
      {
        sub: 'user-emp-1',
        tenantId: 'tenant-1',
        role: 'employee',
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      secret,
    );

    const err = new Error('No responders');
    err.name = 'EmptyResponseException';
    client.send.mockReturnValue(throwError(() => err));

    await expect(
      service.verifyToken(expiredJwt, { jwtSecret: secret }),
    ).rejects.toBeInstanceOf(InvalidTokenException);

    await expect(
      service.verifyToken(`${expiredJwt}tampered`, { jwtSecret: secret }),
    ).rejects.toBeInstanceOf(InvalidTokenException);
  });

  it('maps a remote error object to an AppException with the same status and code', async () => {
    client.send.mockReturnValueOnce(
      throwError(() => ({
        status: 401,
        code: 'invalid_token',
        message: 'Token expired',
      })),
    );

    const error = await service.verifyToken('expired').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({ status: 401, code: 'invalid_token' });
  });

  it('maps a timeout to UpstreamTimeoutException', async () => {
    client.send.mockReturnValueOnce(NEVER);

    await expect(
      service.request(NATS_PATTERNS.AUTH_TOKEN_VERIFY, {}, 10),
    ).rejects.toBeInstanceOf(UpstreamTimeoutException);
  });

  it('maps a no-responders error to UpstreamUnavailableException', async () => {
    const err = new Error('No responders');
    err.name = 'EmptyResponseException';
    client.send.mockReturnValueOnce(throwError(() => err));

    await expect(service.verifyToken('token')).rejects.toBeInstanceOf(
      UpstreamUnavailableException,
    );
  });

  it('maps any other error to UpstreamUnavailableException', async () => {
    client.send.mockReturnValueOnce(throwError(() => new Error('boom')));

    await expect(service.verifyToken('token')).rejects.toBeInstanceOf(
      UpstreamUnavailableException,
    );
  });

  it.each([
    [
      'verifyToken',
      NATS_PATTERNS.AUTH_TOKEN_VERIFY,
      ['tok'],
      { accessToken: 'tok' },
    ],
    [
      'getEmployee',
      NATS_PATTERNS.ORGANIZATION_EMPLOYEE_GET,
      ['t1', 'u1'],
      { tenantId: 't1', userId: 'u1' },
    ],
    [
      'getSite',
      NATS_PATTERNS.ORGANIZATION_SITE_GET,
      ['t1', 's1'],
      { tenantId: 't1', siteId: 's1' },
    ],
    [
      'getShift',
      NATS_PATTERNS.ORGANIZATION_SHIFT_GET,
      ['t1', 'sh1'],
      { tenantId: 't1', shiftId: 'sh1' },
    ],
  ] as const)(
    '%s sends the right pattern and payload',
    async (method, pattern, args, payload) => {
      client.send.mockReturnValueOnce(of({ ok: true }));

      await (service[method] as (...a: readonly string[]) => Promise<unknown>)(
        ...args,
      );

      expect(client.send).toHaveBeenCalledWith(pattern, payload);
    },
  );
});
