jest.mock('../../config', () => ({
  envs: {
    notificationsDatabaseUrl:
      'postgresql://notifications_svc:secret@localhost:5432/teamworkflow?schema=notifications',
  },
}));
jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
}));

import { NotificationNotFoundException } from '../../common/exceptions/app.exceptions';
import type { NotificationsPrismaService } from '../prisma/prisma.service';
import type { NotificationActor } from '../push-tokens/push-tokens.service';
import { InAppNotificationsService } from './in-app-notifications.service';

describe('InAppNotificationsService', () => {
  let service: InAppNotificationsService;
  let mockPrisma: {
    notification: {
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const actor: NotificationActor = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'supervisor',
  };

  beforeEach(() => {
    mockPrisma = {
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new InAppNotificationsService(
      mockPrisma as unknown as NotificationsPrismaService,
    );
  });

  it('lists notifications paginated newest-first scoped to actor tenant and user', async () => {
    const createdAt = new Date('2026-11-12T10:00:00.000Z');
    mockPrisma.notification.findMany.mockResolvedValueOnce([
      {
        id: 'notif-1',
        templateCode: 'alert_opened',
        locale: 'es',
        title: 'Nueva alerta',
        body: 'Cuerpo',
        data: { alertId: 'a-1' },
        readAt: null,
        createdAt,
      },
    ]);
    mockPrisma.notification.count.mockResolvedValueOnce(1);

    const res = await service.list(actor, {
      page: 1,
      pageSize: 10,
      unreadOnly: true,
    });

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', userId: 'user-1', readAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 10,
    });
    expect(res).toEqual({
      items: [
        {
          id: 'notif-1',
          templateCode: 'alert_opened',
          locale: 'es',
          title: 'Nueva alerta',
          body: 'Cuerpo',
          data: { alertId: 'a-1' },
          readAt: null,
          createdAt: '2026-11-12T10:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    });
  });

  it('returns unread notification count for actor', async () => {
    mockPrisma.notification.count.mockResolvedValueOnce(4);

    const res = await service.unreadCount(actor);

    expect(mockPrisma.notification.count).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', userId: 'user-1', readAt: null },
    });
    expect(res).toEqual({ count: 4 });
  });

  it('marks a single notification as read idempotently and throws 404 when not owned', async () => {
    mockPrisma.notification.findFirst.mockResolvedValueOnce({
      id: 'notif-1',
      readAt: null,
    });
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 1 });

    const first = await service.markRead(actor, { notificationId: 'notif-1' });
    expect(first.updatedCount).toBe(1);
    expect(first.id).toBe('notif-1');
    expect(first.readAt).toBeDefined();

    const originalReadAt = new Date('2026-11-12T08:00:00.000Z');
    mockPrisma.notification.findFirst.mockResolvedValueOnce({
      id: 'notif-1',
      readAt: originalReadAt,
    });
    const second = await service.markRead(actor, { notificationId: 'notif-1' });
    expect(second).toEqual({
      updatedCount: 0,
      id: 'notif-1',
      readAt: '2026-11-12T08:00:00.000Z',
    });

    mockPrisma.notification.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.markRead(actor, { notificationId: 'other-user-notif' }),
    ).rejects.toThrow(NotificationNotFoundException);
  });

  it('marks all unread notifications as read when all=true', async () => {
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 3 });

    const res = await service.markRead(actor, { all: true });

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', userId: 'user-1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(res).toEqual({ updatedCount: 3 });
  });
});
