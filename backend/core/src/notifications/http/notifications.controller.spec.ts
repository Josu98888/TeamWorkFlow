import 'reflect-metadata';

jest.mock('../../config', () => ({
  envs: {
    notificationsDatabaseUrl:
      'postgresql://notifications_svc:secret@localhost:5432/teamworkflow?schema=notifications',
  },
}));
jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
  DevicePlatform: { ANDROID: 'ANDROID', IOS: 'IOS' },
}));

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { VerifiedActor } from '../../auth/verified-actor';
import { ForbiddenException } from '../../common/exceptions/app.exceptions';
import type { NotificationsService } from '../notifications.service';
import {
  ListNotificationsQueryDto,
  MarkReadParamDto,
} from './dto/notifications.dto';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let mockService: {
    notificationList: jest.Mock;
    notificationUnreadCount: jest.Mock;
    notificationMarkRead: jest.Mock;
  };

  const tenantActor: VerifiedActor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'supervisor',
    siteIds: ['site-1'],
    tenantStatus: 'active',
    plan: 'pro',
    features: { tasks: true, alerts: true, tower: true },
  };

  const platformAdmin: VerifiedActor = {
    userId: 'plat-1',
    tenantId: null,
    role: 'platform_admin',
    siteIds: [],
    tenantStatus: null,
    plan: null,
    features: null,
  };

  beforeEach(() => {
    mockService = {
      notificationList: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      notificationUnreadCount: jest.fn().mockResolvedValue({ count: 3 }),
      notificationMarkRead: jest.fn().mockResolvedValue({ updatedCount: 1 }),
    };
    controller = new NotificationsController(
      mockService as unknown as NotificationsService,
    );
  });

  it('lists notifications, gets unread count, and marks single or all read', async () => {
    await expect(
      controller.list(tenantActor, { page: 1, pageSize: 20, unreadOnly: true }),
    ).resolves.toMatchObject({ total: 0 });
    expect(mockService.notificationList).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1', role: 'supervisor' },
      { page: 1, pageSize: 20, unreadOnly: true },
    );

    await expect(controller.unreadCount(tenantActor)).resolves.toEqual({
      count: 3,
    });

    await controller.markRead(tenantActor, {
      id: '019320a0-0000-7000-8000-000000000001',
    });
    expect(mockService.notificationMarkRead).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1', role: 'supervisor' },
      { notificationId: '019320a0-0000-7000-8000-000000000001' },
    );

    await controller.markRead(tenantActor, { id: 'all' });
    expect(mockService.notificationMarkRead).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1', role: 'supervisor' },
      { all: true },
    );
  });

  it('rejects platform_admin with ForbiddenException', () => {
    expect(() => controller.list(platformAdmin, {})).toThrow(
      ForbiddenException,
    );
    expect(() => controller.unreadCount(platformAdmin)).toThrow(
      ForbiddenException,
    );
  });

  it('validates MarkReadParamDto and ListNotificationsQueryDto', async () => {
    const validAll = plainToInstance(MarkReadParamDto, { id: 'all' });
    expect(await validate(validAll)).toHaveLength(0);

    const validUuid = plainToInstance(MarkReadParamDto, {
      id: '019320a0-0000-7000-8000-000000000001',
    });
    expect(await validate(validUuid)).toHaveLength(0);

    const invalidParam = plainToInstance(MarkReadParamDto, {
      id: 'bad-id',
    });
    expect((await validate(invalidParam)).length).toBeGreaterThan(0);

    const validQuery = plainToInstance(ListNotificationsQueryDto, {
      page: '2',
      pageSize: '25',
      unreadOnly: 'true',
    });
    expect(await validate(validQuery)).toHaveLength(0);
    expect(validQuery).toEqual({
      page: 2,
      pageSize: 25,
      unreadOnly: true,
    });
  });
});
