const mockCert = jest.fn((sa: unknown) => ({ sa }));
const mockGetApps = jest.fn(() => [] as { name: string }[]);
const mockInitializeApp = jest.fn((_cfg: unknown, name: string) => ({ name }));
const mockSend = jest.fn();
const mockGetMessaging = jest.fn(() => ({ send: mockSend }));

jest.mock('../../config', () => ({
  envs: {
    fcmEnabled: false,
    fcmProjectId: 'test-project',
    fcmCredentials: '',
  },
}));
jest.mock('firebase-admin/app', () => ({
  cert: mockCert,
  getApps: mockGetApps,
  initializeApp: mockInitializeApp,
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: mockGetMessaging,
}));

import { FakeFcmProviderService } from './fake-fcm-provider.service';
import { FirebaseAdminProviderService } from './firebase-admin-provider.service';

describe('FCM Providers', () => {
  describe('FakeFcmProviderService', () => {
    let provider: FakeFcmProviderService;

    beforeEach(() => {
      provider = new FakeFcmProviderService();
    });

    it('records sent messages and returns success with messageId', async () => {
      const result = await provider.send({
        token: 'fcm-tok-1',
        title: 'Alerta',
        body: 'Cuerpo',
        data: { alertId: 'a-1' },
      });

      expect(result).toEqual({
        success: true,
        messageId: 'fake-fcm-1',
      });
      expect(provider.getSentMessages()).toHaveLength(1);
      expect(provider.getSentMessages()[0]?.token).toBe('fcm-tok-1');
    });

    it('reports isUnregistered when token is marked unregistered', async () => {
      provider.simulateUnregistered('dead-tok');

      const result = await provider.send({
        token: 'dead-tok',
        title: 'Titulo',
        body: 'Mensaje',
      });

      expect(result).toEqual({
        success: false,
        error: 'messaging/registration-token-not-registered',
        isUnregistered: true,
      });
    });

    it('reports retryable failure without marking unregistered', async () => {
      provider.simulateFailure('flaky-tok', 'messaging/unavailable');

      const result = await provider.send({
        token: 'flaky-tok',
        title: 'Titulo',
        body: 'Mensaje',
      });

      expect(result).toEqual({
        success: false,
        error: 'messaging/unavailable',
        isUnregistered: false,
      });
    });
  });

  describe('FirebaseAdminProviderService', () => {
    const validSaJson = JSON.stringify({
      type: 'service_account',
      project_id: 'twf-test',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      client_email: 'fcm@twf-test.iam.gserviceaccount.com',
    });

    beforeEach(() => {
      jest.clearAllMocks();
      mockGetApps.mockReturnValue([]);
    });

    it('initializes firebase app from raw JSON credentials and sends push', async () => {
      mockSend.mockResolvedValueOnce('projects/twf-test/messages/123');
      const provider = new FirebaseAdminProviderService({
        projectId: 'twf-test',
        credentials: validSaJson,
      });

      const result = await provider.send({
        token: 'secret-device-token-xyz',
        title: 'Nueva tarea',
        body: 'Revisar sector norte',
        data: { taskId: 't-1' },
      });

      expect(mockCert).toHaveBeenCalledTimes(1);
      expect(mockInitializeApp).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith({
        token: 'secret-device-token-xyz',
        notification: { title: 'Nueva tarea', body: 'Revisar sector norte' },
        data: { taskId: 't-1' },
      });
      expect(result).toEqual({
        success: true,
        messageId: 'projects/twf-test/messages/123',
      });
    });

    it('supports base64-encoded JSON credentials', async () => {
      mockSend.mockResolvedValueOnce('msg-b64');
      const b64 = Buffer.from(validSaJson, 'utf8').toString('base64');
      const provider = new FirebaseAdminProviderService({
        credentials: b64,
      });

      const result = await provider.send({
        token: 'tok-b64',
        title: 'Hola',
        body: 'Mundo',
      });

      expect(result.success).toBe(true);
      expect(mockCert).toHaveBeenCalledTimes(1);
    });

    it('marks registration-token-not-registered and invalid-registration-token as unregistered', async () => {
      const provider = new FirebaseAdminProviderService({
        credentials: validSaJson,
      });
      mockSend
        .mockRejectedValueOnce({
          code: 'messaging/registration-token-not-registered',
          message: 'Requested entity was not found.',
        })
        .mockRejectedValueOnce({
          code: 'messaging/invalid-registration-token',
          message: 'Invalid registration token provided.',
        });

      const r1 = await provider.send({
        token: 'unreg-tok',
        title: 'T',
        body: 'B',
      });
      const r2 = await provider.send({
        token: 'invalid-tok',
        title: 'T',
        body: 'B',
      });

      expect(r1).toEqual({
        success: false,
        error: 'messaging/registration-token-not-registered',
        isUnregistered: true,
      });
      expect(r2).toEqual({
        success: false,
        error: 'messaging/invalid-registration-token',
        isUnregistered: true,
      });
    });

    it('returns non-unregistered failure for transient FCM errors', async () => {
      const provider = new FirebaseAdminProviderService({
        credentials: validSaJson,
      });
      mockSend.mockRejectedValueOnce({
        code: 'messaging/internal-error',
        message: 'Temporary error',
      });

      const res = await provider.send({
        token: 'tok-transient',
        title: 'T',
        body: 'B',
      });

      expect(res).toEqual({
        success: false,
        error: 'messaging/internal-error',
        isUnregistered: false,
      });
    });
  });
});
