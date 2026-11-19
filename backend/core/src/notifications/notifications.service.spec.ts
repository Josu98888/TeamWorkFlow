jest.mock('../config', () => ({
  envs: {
    notificationsDatabaseUrl:
      'postgresql://notifications_svc:secret@localhost:5432/teamworkflow?schema=notifications',
  },
}));
jest.mock('./prisma/generated/client', () => ({
  PrismaClient: class {},
  DevicePlatform: { ANDROID: 'ANDROID', IOS: 'IOS' },
}));

import type { InAppNotificationsService } from './in-app/in-app-notifications.service';
import { NotificationsService } from './notifications.service';
import type { PushTokensService } from './push-tokens/push-tokens.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockPushTokens: {
    register: jest.Mock;
    unregister: jest.Mock;
  };
  let mockInApp: {
    list: jest.Mock;
    unreadCount: jest.Mock;
    markRead: jest.Mock;
  };

  const actor = { tenantId: 'tenant-1', userId: 'user-1', role: 'employee' };

  beforeEach(() => {
    mockPushTokens = {
      register: jest.fn().mockResolvedValue({ id: 'dt-1', platform: 'android', isActive: true, lastSeenAt: '2026-11-12T00:00:00.000Z' }),
      unregister: jest.fn().mockResolvedValue({ unregistered: true }),
    };
    mockInApp = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      unreadCount: jest.fn().mockResolvedValue({ count: 2 }),
      markRead: jest.fn().mockResolvedValue({ updatedCount: 1 }),
    };
    service = new NotificationsService(
      mockPushTokens as unknown as PushTokensService,
      mockInApp as unknown as InAppNotificationsService,
    );
  });

  it('delegates all 5 contract operations to underlying services', async () => {
    await expect(
      service.pushTokenRegister(actor, { token: 't1', platform: 'android' }),
    ).resolves.toMatchObject({ id: 'dt-1' });
    expect(mockPushTokens.register).toHaveBeenCalledWith(actor, {
      token: 't1',
      platform: 'android',
    });

    await expect(
      service.pushTokenUnregister(actor, { token: 't1' }),
    ).resolves.toEqual({ unregistered: true });
    expect(mockPushTokens.unregister).toHaveBeenCalledWith(actor, {
      token: 't1',
    });

    await expect(
      service.notificationList(actor, { page: 2, pageSize: 10, unreadOnly: true }),
    ).resolves.toMatchObject({ total: 0 });
    expect(mockInApp.list).toHaveBeenCalledWith(actor, {
      page: 2,
      pageSize: 10,
      unreadOnly: true,
    });

    await expect(service.notificationUnreadCount(actor)).resolves.toEqual({
      count: 2,
    });
    expect(mockInApp.unreadCount).toHaveBeenCalledWith(actor);

    await expect(
      service.notificationMarkRead(actor, { all: true }),
    ).resolves.toEqual({ updatedCount: 1 });
    expect(mockInApp.markRead).toHaveBeenCalledWith(actor, { all: true });
  });
});
