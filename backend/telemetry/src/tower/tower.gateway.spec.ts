import { Test, TestingModule } from '@nestjs/testing';
import { MAX_SOCKET_SESSION_MS, TowerGateway } from './tower.gateway';
import { JetStreamService, type EventHandler } from '../nats/jetstream.service';
import { NatsClientService } from '../nats/nats-client.service';
import type { Socket } from 'socket.io';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

describe('TowerGateway', () => {
  let gateway: TowerGateway;
  let registeredBroadcastHandler: EventHandler | undefined;

  const mockNatsClient = {
    verifyToken: jest.fn(),
  };

  const mockJetStream = {
    registerBroadcastHandler: jest.fn(
      (_filter: string, handler: EventHandler) => {
        registeredBroadcastHandler = handler;
      },
    ),
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

  const towerActor = (
    overrides: Partial<VerifiedActor> = {},
  ): VerifiedActor => ({
    userId: 'user-sup',
    tenantId: 'tenant-1',
    role: 'supervisor',
    siteIds: ['site-1'],
    tenantStatus: 'active',
    plan: 'pro',
    features: { tower: true },
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    registeredBroadcastHandler = undefined;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TowerGateway,
        { provide: NatsClientService, useValue: mockNatsClient },
        { provide: JetStreamService, useValue: mockJetStream },
      ],
    }).compile();

    gateway = module.get<TowerGateway>(TowerGateway);
    gateway.onModuleInit();
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
        handshake: { auth: { token: 'admin-socket-token' } },
      });
      mockNatsClient.verifyToken.mockResolvedValue(
        towerActor({ userId: 'user-admin', role: 'admin', siteIds: [] }),
      );

      await gateway.handleConnection(mock.socket);

      expect(mock.join).toHaveBeenCalledWith('tenant-1:all');
      expect(mock.disconnect).not.toHaveBeenCalled();
    });

    it('verifies handshake.auth.token with the socket purpose', async () => {
      const mock = createMockSocket({
        handshake: { auth: { token: '  socket-token  ' } },
      });
      mockNatsClient.verifyToken.mockResolvedValue(towerActor());

      await gateway.handleConnection(mock.socket);

      expect(mockNatsClient.verifyToken).toHaveBeenCalledTimes(1);
      expect(mockNatsClient.verifyToken).toHaveBeenCalledWith('socket-token', {
        purpose: 'socket',
      });
    });

    it('ignores the Authorization header and the access_token cookie', async () => {
      const mock = createMockSocket({
        handshake: {
          headers: {
            authorization: 'Bearer an-access-token',
            cookie: 'access_token=an-access-token; other_cookie=123',
          },
          auth: {},
        },
      });

      await gateway.handleConnection(mock.socket);

      expect(mockNatsClient.verifyToken).not.toHaveBeenCalled();
      expect(mock.disconnect).toHaveBeenCalledWith(true);
      expect(mock.join).not.toHaveBeenCalled();
    });

    it('takes the token only from handshake.auth even when other carriers are present', async () => {
      const mock = createMockSocket({
        handshake: {
          headers: {
            authorization: 'Bearer header-token',
            cookie: 'access_token=cookie-token',
          },
          auth: { token: 'auth-token' },
        },
      });
      mockNatsClient.verifyToken.mockResolvedValue(towerActor());

      await gateway.handleConnection(mock.socket);

      expect(mockNatsClient.verifyToken).toHaveBeenCalledWith('auth-token', {
        purpose: 'socket',
      });
    });

    it.each([
      ['an empty token', ''],
      ['a blank token', '   '],
      ['a non-string token', 42],
      ['an object token', { value: 'x' }],
    ])('disconnects on %s without verifying', async (_label, token) => {
      const mock = createMockSocket({ handshake: { auth: { token } } });

      await gateway.handleConnection(mock.socket);

      expect(mockNatsClient.verifyToken).not.toHaveBeenCalled();
      expect(mock.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects without joining rooms when core rejects the token', async () => {
      const mock = createMockSocket({
        handshake: { auth: { token: 'an-access-token' } },
      });
      mockNatsClient.verifyToken.mockRejectedValue(
        Object.assign(new Error('invalid_token'), { status: 401 }),
      );

      await gateway.handleConnection(mock.socket);

      expect(mock.disconnect).toHaveBeenCalledWith(true);
      expect(mock.join).not.toHaveBeenCalled();
      expect(mock.socket.data.actor).toBeUndefined();
    });

    it('does not join rooms when the client left during verification', async () => {
      const mock = createMockSocket({
        handshake: { auth: { token: 'socket-token' } },
        disconnected: true,
      });
      mockNatsClient.verifyToken.mockResolvedValue(towerActor());

      await gateway.handleConnection(mock.socket);

      expect(mock.join).not.toHaveBeenCalled();
      expect(mock.socket.data.actor).toBeUndefined();
    });

    describe('session limit', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('disconnects exactly when the fixed session limit is reached', async () => {
        const mock = createMockSocket({
          handshake: { auth: { token: 'socket-token' } },
        });
        mockNatsClient.verifyToken.mockResolvedValue(towerActor());

        await gateway.handleConnection(mock.socket);
        jest.advanceTimersByTime(MAX_SOCKET_SESSION_MS - 1);
        expect(mock.disconnect).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(mock.disconnect).toHaveBeenCalledWith(true);
      });

      it('outlives the 60 second socket token', async () => {
        const mock = createMockSocket({
          handshake: { auth: { token: 'socket-token' } },
        });
        mockNatsClient.verifyToken.mockResolvedValue(
          towerActor({ exp: Math.floor(Date.now() / 1000) + 60 }),
        );

        await gateway.handleConnection(mock.socket);
        jest.advanceTimersByTime(5 * 60_000);

        expect(mock.disconnect).not.toHaveBeenCalled();
      });

      it('does not reject an actor whose exp already passed (exp is not used)', async () => {
        const mock = createMockSocket({
          handshake: { auth: { token: 'socket-token' } },
        });
        mockNatsClient.verifyToken.mockResolvedValue(
          towerActor({ exp: Math.floor(Date.now() / 1000) - 10 }),
        );

        await gateway.handleConnection(mock.socket);

        expect(mock.disconnect).not.toHaveBeenCalled();
        expect(mock.join).toHaveBeenCalled();
      });

      it('clears the session timer when the client disconnects first', async () => {
        const mock = createMockSocket({
          handshake: { auth: { token: 'socket-token' } },
        });
        mockNatsClient.verifyToken.mockResolvedValue(towerActor());
        await gateway.handleConnection(mock.socket);

        gateway.handleDisconnect(mock.socket);
        jest.advanceTimersByTime(MAX_SOCKET_SESSION_MS * 2);

        expect(mock.disconnect).not.toHaveBeenCalled();
      });

      it('caps the session at 15 minutes', () => {
        expect(MAX_SOCKET_SESSION_MS).toBe(15 * 60_000);
      });
    });
  });

  describe('broadcastSiteSummary & multi-replica NATS fanout', () => {
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

    it('forwards site_summary_updated received over NATS from another replica to local rooms', async () => {
      const mockServer = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      gateway.server = mockServer as any;

      expect(registeredBroadcastHandler).toBeDefined();
      await registeredBroadcastHandler!({
        subject: 't.tenant-1.attendance.site_summary_updated',
        tenantId: 'tenant-1',
        payload: {
          eventId: 'evt-remote-1',
          tenantId: 'tenant-1',
          siteId: 'site-2',
          expected: 5,
          present: 4,
          openAlerts: 1,
        },
      });

      expect(mockServer.to).toHaveBeenCalledWith('tenant-1:site-2');
      expect(mockServer.to).toHaveBeenCalledWith('tenant-1:all');
      expect(mockServer.emit).toHaveBeenCalledWith('site_summary_updated', {
        siteId: 'site-2',
        expected: 5,
        present: 4,
        openAlerts: 1,
      });
    });

    it('discards NATS site_summary_updated when subject tenantId mismatches payload tenantId', async () => {
      const mockServer = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      gateway.server = mockServer as any;

      await registeredBroadcastHandler!({
        subject: 't.tenant-1.attendance.site_summary_updated',
        tenantId: 'tenant-1',
        payload: {
          eventId: 'evt-spoofed',
          tenantId: 'tenant-2',
          siteId: 'site-2',
          expected: 5,
          present: 4,
          openAlerts: 1,
        },
      });

      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('deduplicates NATS site_summary_updated when eventId was already broadcast locally', async () => {
      const mockServer = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      gateway.server = mockServer as any;

      gateway.recordLocalBroadcast('evt-local-1');

      await registeredBroadcastHandler!({
        subject: 't.tenant-1.attendance.site_summary_updated',
        tenantId: 'tenant-1',
        payload: {
          eventId: 'evt-local-1',
          tenantId: 'tenant-1',
          siteId: 'site-1',
          expected: 2,
          present: 2,
          openAlerts: 0,
        },
      });

      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });
});
