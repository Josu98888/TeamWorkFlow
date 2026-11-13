jest.mock('../../config', () => ({
  envs: {
    notificationsDatabaseUrl:
      'postgresql://notifications_svc:secret@localhost:5432/teamworkflow?schema=notifications',
  },
}));
jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
  NotificationChannel: { PUSH: 'PUSH', IN_APP: 'IN_APP' },
  DeliveryStatus: { PENDING: 'PENDING', SENT: 'SENT', FAILED: 'FAILED' },
}));

import type { FcmProvider } from '../providers/fcm-provider.interface';
import type { NotificationsPrismaService } from '../prisma/prisma.service';
import { DeliveryRetryJob, MAX_PUSH_ATTEMPTS } from './delivery-retry.job';

describe('DeliveryRetryJob', () => {
  let job: DeliveryRetryJob;
  let mockPrisma: {
    notificationDelivery: {
      findMany: jest.Mock;
      update: jest.Mock;
    };
    tenantState: {
      findMany: jest.Mock;
    };
    deviceToken: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let mockFcm: { send: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      notificationDelivery: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      tenantState: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      deviceToken: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mockFcm = { send: jest.fn() };
    job = new DeliveryRetryJob(
      mockPrisma as unknown as NotificationsPrismaService,
      mockFcm as unknown as FcmProvider,
    );
  });

  it('retries eligible failed PUSH deliveries and marks SENT on success', async () => {
    mockPrisma.notificationDelivery.findMany.mockResolvedValueOnce([
      {
        id: 'deliv-1',
        tenantId: 'tenant-1',
        deviceTokenId: 'dt-1',
        attempts: 1,
        notification: {
          id: 'notif-1',
          title: 'Titulo',
          body: 'Cuerpo',
          templateCode: 'alert_opened',
          data: { siteName: 'Sede Norte' },
        },
      },
    ]);
    mockPrisma.deviceToken.findMany.mockResolvedValueOnce([
      { id: 'dt-1', token: 'tok-active', isActive: true },
    ]);
    mockFcm.send.mockResolvedValueOnce({ success: true, messageId: 'ok-1' });

    const count = await job.retryFailedDeliveries();

    expect(count).toBe(1);
    expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'deliv-1' },
      data: {
        status: 'SENT',
        attempts: 2,
        sentAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it('skips suspended tenants completely during retries', async () => {
    mockPrisma.notificationDelivery.findMany.mockResolvedValueOnce([
      {
        id: 'deliv-susp',
        tenantId: 'tenant-suspended',
        deviceTokenId: 'dt-1',
        attempts: 1,
        notification: {
          id: 'notif-1',
          title: 'T',
          body: 'B',
          templateCode: 'alert_opened',
          data: null,
        },
      },
    ]);
    mockPrisma.tenantState.findMany.mockResolvedValueOnce([
      { tenantId: 'tenant-suspended' },
    ]);

    const count = await job.retryFailedDeliveries();

    expect(count).toBe(0);
    expect(mockFcm.send).not.toHaveBeenCalled();
  });

  it('deactivates unregistered tokens and skips inactive tokens without calling FCM', async () => {
    mockPrisma.notificationDelivery.findMany.mockResolvedValueOnce([
      {
        id: 'deliv-unreg',
        tenantId: 'tenant-1',
        deviceTokenId: 'dt-dead',
        attempts: 1,
        notification: {
          id: 'notif-1',
          title: 'T',
          body: 'B',
          templateCode: 'task_assigned',
          data: null,
        },
      },
      {
        id: 'deliv-inactive',
        tenantId: 'tenant-1',
        deviceTokenId: 'dt-already-inactive',
        attempts: 1,
        notification: {
          id: 'notif-2',
          title: 'T2',
          body: 'B2',
          templateCode: 'task_assigned',
          data: null,
        },
      },
    ]);
    mockPrisma.deviceToken.findMany.mockResolvedValueOnce([
      { id: 'dt-dead', token: 'dead-tok', isActive: true },
      { id: 'dt-already-inactive', token: 'old-tok', isActive: false },
    ]);
    mockFcm.send.mockResolvedValueOnce({
      success: false,
      error: 'messaging/registration-token-not-registered',
      isUnregistered: true,
    });

    const count = await job.retryFailedDeliveries();

    expect(count).toBe(0);
    expect(mockFcm.send).toHaveBeenCalledTimes(1);
    expect(mockPrisma.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'dt-dead' },
      data: { isActive: false },
    });
    expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'deliv-unreg' },
      data: {
        status: 'FAILED',
        attempts: 2,
        lastError: 'messaging/registration-token-not-registered',
      },
    });
    expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'deliv-inactive' },
      data: {
        attempts: MAX_PUSH_ATTEMPTS,
        lastError: 'device_token_inactive',
      },
    });
  });

  it('stops retrying once attempts reach MAX_PUSH_ATTEMPTS', async () => {
    mockPrisma.notificationDelivery.findMany.mockResolvedValueOnce([]);
    await job.retryFailedDeliveries();
    expect(mockPrisma.notificationDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channel: 'PUSH',
          status: 'FAILED',
          attempts: { lt: MAX_PUSH_ATTEMPTS },
        },
      }),
    );
  });
});
