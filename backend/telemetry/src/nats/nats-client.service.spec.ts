import { of, throwError, NEVER } from 'rxjs';
import { NatsClientService } from './nats-client.service';
import { NATS_PATTERNS } from './nats.constants';
import {
  AppException,
  UpstreamTimeoutException,
  UpstreamUnavailableException,
} from '../common/exceptions';

describe('NatsClientService', () => {
  const client = { send: jest.fn() };
  let service: NatsClientService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NatsClientService(client as never);
  });

  it('returns the payload of the reply', async () => {
    const actor = { userId: 'user-123', tenantId: 'tenant-123', role: 'employee' };
    client.send.mockReturnValueOnce(of(actor));

    await expect(service.verifyToken('valid-token')).resolves.toEqual(actor);
  });

  it('maps a remote error object to an AppException with the same status and code', async () => {
    client.send.mockReturnValueOnce(
      throwError(() => ({ status: 401, code: 'invalid_token', message: 'Token expired' })),
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
    ['verifyToken', NATS_PATTERNS.AUTH_TOKEN_VERIFY, ['tok'], { accessToken: 'tok' }],
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
  ] as const)('%s sends the right pattern and payload', async (method, pattern, args, payload) => {
    client.send.mockReturnValueOnce(of({ ok: true }));

    await (service[method] as (...a: readonly string[]) => Promise<unknown>)(...args);

    expect(client.send).toHaveBeenCalledWith(pattern, payload);
  });
});
