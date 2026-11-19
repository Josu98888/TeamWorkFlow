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
import { DeliveryService } from './delivery.service';

describe('DeliveryService', () => {
  let service: DeliveryService;
  let mockPrisma: {
    notification: {
      findMany: jest.Mock;
      create: jest.Mock;
    };
    deviceToken: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    notificationDelivery: {
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let mockFcm: { send: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      deviceToken: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notificationDelivery: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn(mockPrisma),
      ),
    };
    mockFcm = { send: jest.fn() };
    service = new DeliveryService(
      mockPrisma as unknown as NotificationsPrismaService,
      mockFcm as unknown as FcmProvider,
    );
  });

  it('creates Notification + SENT IN_APP + PENDING PUSH and dispatches after commit', async () => {
    mockPrisma.deviceToken.findMany.mockResolvedValueOnce([
      { id: 'dt-1', userId: 'user-1', token: 'fcm-token-1' },
    ]);
    mockPrisma.notification.create.mockResolvedValueOnce({
      id: 'notif-1',
    });
    mockPrisma.notificationDelivery.create
      .mockResolvedValueOnce({ id: 'deliv-inapp' })
      .mockResolvedValueOnce({ id: 'deliv-push' });
    mockFcm.send.mockResolvedValueOnce({ success: true, messageId: 'msg-1' });

    const count = await service.deliver({
      tenantId: 'tenant-1',
      recipientUserIds: ['user-1', 'user-1'],
      templateCode: 'task_assigned',
      data: { title: 'Control diario', deadline: '2026-11-15' },
      sourceEventId: 'evt-1',
    });

    expect(count).toBe(1);
    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.notificationDelivery.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        channel: 'IN_APP',
        status: 'SENT',
        attempts: 1,
      }),
    });
    expect(mockPrisma.notificationDelivery.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        channel: 'PUSH',
        deviceTokenId: 'dt-1',
        status: 'PENDING',
        attempts: 0,
      }),
    });
    expect(mockFcm.send).toHaveBeenCalledWith({
      token: 'fcm-token-1',
      title: 'Nueva tarea asignada',
      body: expect.stringContaining('Control diario'),
      data: {
        templateCode: 'task_assigned',
        notificationId: 'notif-1',
        title: 'Control diario',
        deadline: '2026-11-15',
      },
    });
    expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'deliv-push' },
      data: {
        status: 'SENT',
        attempts: 1,
        sentAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it('deactivates device token immediately when FCM reports isUnregistered', async () => {
    mockPrisma.deviceToken.findMany.mockResolvedValueOnce([
      { id: 'dt-dead', userId: 'user-1', token: 'dead-token' },
    ]);
    mockPrisma.notification.create.mockResolvedValueOnce({ id: 'notif-2' });
    mockPrisma.notificationDelivery.create
      .mockResolvedValueOnce({ id: 'deliv-inapp' })
      .mockResolvedValueOnce({ id: 'deliv-push-dead' });
    mockFcm.send.mockResolvedValueOnce({
      success: false,
      error: 'messaging/registration-token-not-registered',
      isUnregistered: true,
    });

    await service.deliver({
      tenantId: 'tenant-1',
      recipientUserIds: ['user-1'],
      templateCode: 'billing_suspended',
      data: { invoiceId: 'inv-9' },
      sourceEventId: 'evt-2',
    });

    expect(mockPrisma.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'dt-dead' },
      data: { isActive: false },
    });
    expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'deliv-push-dead' },
      data: {
        status: 'FAILED',
        attempts: 1,
        lastError: 'messaging/registration-token-not-registered',
      },
    });
  });

  it('skips unknown templates and already notified recipients cleanly', async () => {
    const unknownCount = await service.deliver({
      tenantId: 'tenant-1',
      recipientUserIds: ['user-1'],
      templateCode: 'nonexistent_template',
      sourceEventId: 'evt-3',
    });
    expect(unknownCount).toBe(0);
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();

    mockPrisma.notification.findMany.mockResolvedValueOnce([
      { userId: 'user-1' },
    ]);
    const dupCount = await service.deliver({
      tenantId: 'tenant-1',
      recipientUserIds: ['user-1'],
      templateCode: 'billing_suspended',
      data: { invoiceId: 'inv-1' },
      sourceEventId: 'evt-dup',
    });
    expect(dupCount).toBe(0);
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
  });
});
