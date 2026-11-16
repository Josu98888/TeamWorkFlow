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

import type { VerifiedActor } from '../../auth/verified-actor';
import { ForbiddenException } from '../../common/exceptions/app.exceptions';
import type { NotificationsService } from '../notifications.service';
import { PushTokensController } from './push-tokens.controller';

describe('PushTokensController', () => {
  let controller: PushTokensController;
  let mockService: {
    pushTokenRegister: jest.Mock;
    pushTokenUnregister: jest.Mock;
  };

  const tenantActor: VerifiedActor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'employee',
    siteIds: [],
    tenantStatus: 'active',
    plan: 'basic',
    features: { tasks: false, alerts: false, tower: false },
  };

  const platformAdmin: VerifiedActor = {
    userId: 'admin-plat',
    tenantId: null,
    role: 'platform_admin',
    siteIds: [],
    tenantStatus: null,
    plan: null,
    features: null,
  };

  beforeEach(() => {
    mockService = {
      pushTokenRegister: jest.fn().mockResolvedValue({
        id: 'dt-1',
        platform: 'ios',
        isActive: true,
        lastSeenAt: '2026-11-12T00:00:00.000Z',
      }),
      pushTokenUnregister: jest.fn().mockResolvedValue({ unregistered: true }),
    };
    controller = new PushTokensController(
      mockService as unknown as NotificationsService,
    );
  });

  it('registers and unregisters token with verified tenant actor only', async () => {
    await expect(
      controller.register(tenantActor, { token: 'fcm-tok', platform: 'ios' }),
    ).resolves.toMatchObject({ id: 'dt-1', platform: 'ios' });

    expect(mockService.pushTokenRegister).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1', role: 'employee' },
      { token: 'fcm-tok', platform: 'ios' },
    );

    await expect(
      controller.unregister(tenantActor, { token: 'fcm-tok' }),
    ).resolves.toEqual({ unregistered: true });

    expect(mockService.pushTokenUnregister).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1', role: 'employee' },
      { token: 'fcm-tok' },
    );
  });

  it('rejects platform_admin with ForbiddenException', () => {
    expect(() =>
      controller.register(platformAdmin, { token: 'fcm', platform: 'android' }),
    ).toThrow(ForbiddenException);
    expect(() =>
      controller.unregister(platformAdmin, { token: 'fcm' }),
    ).toThrow(ForbiddenException);
  });
});
