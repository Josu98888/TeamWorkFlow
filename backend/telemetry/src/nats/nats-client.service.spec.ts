import { NatsClientService } from './nats-client.service';
import {
  AppException,
  UpstreamTimeoutException,
  UpstreamUnavailableException,
} from '../common/exceptions';

const mockRequest = jest.fn();
const mockDrain = jest.fn();

jest.mock('@nats-io/transport-node', () => ({
  connect: jest.fn().mockImplementation(() =>
    Promise.resolve({
      request: mockRequest,
      drain: mockDrain,
    }),
  ),
}));

describe('NatsClientService', () => {
  let service: NatsClientService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NatsClientService();
  });

  it('performs RPC request successfully and decodes JSON', async () => {
    mockRequest.mockResolvedValueOnce({
      data: Buffer.from(
        JSON.stringify({
          userId: 'user-123',
          tenantId: 'tenant-123',
          role: 'employee',
        }),
      ),
    });

    const result = await service.verifyToken('valid-token');
    expect(result).toEqual({
      userId: 'user-123',
      tenantId: 'tenant-123',
      role: 'employee',
    });
  });

  it('unwraps error payload with status >= 400 into AppException', async () => {
    mockRequest.mockResolvedValueOnce({
      data: Buffer.from(
        JSON.stringify({
          status: 401,
          code: 'invalid_token',
          message: 'Token expired',
        }),
      ),
    });

    await expect(service.verifyToken('expired-token')).rejects.toThrow(
      AppException,
    );
  });

  it('maps NATS TIMEOUT error to UpstreamTimeoutException', async () => {
    const timeoutErr = new Error('Request timed out');
    (timeoutErr as any).code = 'TIMEOUT';
    mockRequest.mockRejectedValueOnce(timeoutErr);

    await expect(service.verifyToken('token')).rejects.toThrow(
      UpstreamTimeoutException,
    );
  });

  it('maps NATS NO_RESPONDERS error to UpstreamUnavailableException', async () => {
    const noRespondersErr = new Error('No responders');
    (noRespondersErr as any).code = 'NO_RESPONDERS';
    mockRequest.mockRejectedValueOnce(noRespondersErr);

    await expect(service.verifyToken('token')).rejects.toThrow(
      UpstreamUnavailableException,
    );
  });
});
