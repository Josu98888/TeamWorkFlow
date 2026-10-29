import { Test, TestingModule } from '@nestjs/testing';
import { TowerGateway } from './tower.gateway';
import { NatsClientService } from '../nats/nats-client.service';
import type { Socket } from 'socket.io';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

describe('TowerGateway', () => {
  let gateway: TowerGateway;

  const mockNatsClient = {
    verifyToken: jest.fn(),
  };

  interface MockSocket {
    socket: Socket;
    join: jest.Mock;
    disconnect: jest.Mock;
  }

  const createMockSocket = (overrides?: any): MockSocket => {
    const disconnect = jest.fn();
    const join = jest.fn();
    const socket = {
      id: 'socket-1',
      handshake: {
        headers: {},
        auth: {},
        ...overrides?.handshake,
      },
      data: {},
      join,
      disconnect,
      ...overrides,
    } as unknown as Socket;

    return { socket, join, disconnect };
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TowerGateway,
        { provide: NatsClientService, useValue: mockNatsClient },
      ],
    }).compile();

    gateway = module.get<TowerGateway>(TowerGateway);
  });

  describe('handleConnection', () => {
    it('disconnects if no token is provided in headers, auth, or cookies', async () => {
      const mock = createMockSocket();

      await gateway.handleConnection(mock.socket);

      expect(mock.disconnect).toHaveBeenCalledWith(true);
      expect(mockNatsClient.verifyToken).not.toHaveBeenCalled();
    });

    it('disconnects if token verification fails', async () => {
      const mock = createMockSocket({
        handshake: { auth: { token: 'invalid-jwt' } },
      });
      mockNatsClient.verifyToken.mockRejectedValue(new Error('Invalid token'));

      await gateway.handleConnection(mock.socket);

      expect(mock.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects if user role is employee', async () => {
      const mock = createMockSocket({
        handshake: { auth: { token: 'valid-jwt' } },
      });
      const actor: VerifiedActor = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        role: 'employee',
        siteIds: ['site-1'],
        tenantStatus: 'active',
        plan: 'pro',
        features: { tower: true },
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      await gateway.handleConnection(mock.socket);

      expect(mock.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects if tenant plan does not have tower feature', async () => {
      const mock = createMockSocket({
        handshake: { auth: { token: 'valid-jwt' } },
      });
      const actor: VerifiedActor = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        role: 'supervisor',
        siteIds: ['site-1'],
        tenantStatus: 'active',
        plan: 'basic',
        features: { tower: false },
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      await gateway.handleConnection(mock.socket);

      expect(mock.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects if tenant status is suspended', async () => {
      const mock = createMockSocket({
        handshake: { auth: { token: 'valid-jwt' } },
      });
      const actor: VerifiedActor = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        role: 'supervisor',
        siteIds: ['site-1'],
        tenantStatus: 'suspended',
        plan: 'pro',
        features: { tower: true },
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      await gateway.handleConnection(mock.socket);

      expect(mock.disconnect).toHaveBeenCalledWith(true);
    });

    it('joins supervisor to each authorized site room', async () => {
      const mock = createMockSocket({
        handshake: { auth: { token: 'valid-jwt' } },
      });
      const actor: VerifiedActor = {
        userId: 'user-sup',
        tenantId: 'tenant-1',
        role: 'supervisor',
        siteIds: ['site-1', 'site-2'],
        tenantStatus: 'active',
        plan: 'pro',
        features: { tower: true },
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      await gateway.handleConnection(mock.socket);

      expect(mock.join).toHaveBeenCalledWith('tenant-1:site-1');
      expect(mock.join).toHaveBeenCalledWith('tenant-1:site-2');
      expect(mock.disconnect).not.toHaveBeenCalled();
      expect(mock.socket.data.actor).toEqual(actor);
    });

    it('joins admin to the tenant-wide room', async () => {
      const mock = createMockSocket({
        handshake: {
          headers: {
            cookie: 'access_token=admin-token; other_cookie=123',
          },
        },
      });
      const actor: VerifiedActor = {
        userId: 'user-admin',
        tenantId: 'tenant-1',
        role: 'admin',
        siteIds: [],
        tenantStatus: 'active',
        plan: 'pro',
        features: { tower: true },
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      await gateway.handleConnection(mock.socket);

      expect(mockNatsClient.verifyToken).toHaveBeenCalledWith('admin-token');
      expect(mock.join).toHaveBeenCalledWith('tenant-1:all');
      expect(mock.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('broadcastSiteSummary', () => {
    it('emits site_summary_updated to site room and tenant room', () => {
      const mockServer = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      gateway.server = mockServer as any;

      const summary = {
        siteId: 'site-1',
        expected: 2,
        present: 1,
        openAlerts: 0,
      };

      gateway.broadcastSiteSummary('tenant-1', 'site-1', summary);

      expect(mockServer.to).toHaveBeenCalledWith('tenant-1:site-1');
      expect(mockServer.to).toHaveBeenCalledWith('tenant-1:all');
      expect(mockServer.emit).toHaveBeenCalledWith(
        'site_summary_updated',
        summary,
      );
    });
  });
});
