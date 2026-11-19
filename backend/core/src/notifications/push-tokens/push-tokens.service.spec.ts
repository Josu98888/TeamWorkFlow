jest.mock('../../config', () => ({
  envs: {
    notificationsDatabaseUrl:
      'postgresql://notifications_svc:secret@localhost:5432/teamworkflow?schema=notifications',
  },
}));
jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
  DevicePlatform: {
    ANDROID: 'ANDROID',
    IOS: 'IOS',
  },
}));

import { InvalidPushTokenException } from '../../common/exceptions/app.exceptions';
import type { NotificationsPrismaService } from '../prisma/prisma.service';
import {
  type NotificationActor,
  PushTokensService,
} from './push-tokens.service';

describe('PushTokensService', () => {
  let service: PushTokensService;
  let mockPrisma: {
    deviceToken: {
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  const actor: NotificationActor = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'employee',
  };

  beforeEach(() => {
    mockPrisma = {
      deviceToken: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    service = new PushTokensService(
      mockPrisma as unknown as NotificationsPrismaService,
    );
  });

  it('registers or reassigns an active push token without returning raw token', async () => {
    const now = new Date('2026-11-12T12:00:00.000Z');
    mockPrisma.deviceToken.upsert.mockResolvedValueOnce({
      id: 'dt-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      token: 'fcm-secret-token-value',
      platform: 'ANDROID',
      isActive: true,
      lastSeenAt: now,
    });

    const summary = await service.register(actor, {
      token: '  fcm-secret-token-value  ',
      platform: 'android',
    });

    expect(mockPrisma.deviceToken.upsert).toHaveBeenCalledWith({
      where: { token: 'fcm-secret-token-value' },
      update: expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        platform: 'ANDROID',
        isActive: true,
      }),
      create: expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        token: 'fcm-secret-token-value',
        platform: 'ANDROID',
        isActive: true,
      }),
    });
    expect(summary).toEqual({
      id: 'dt-1',
      platform: 'android',
      isActive: true,
      lastSeenAt: '2026-11-12T12:00:00.000Z',
    });
    expect(JSON.stringify(summary)).not.toContain('fcm-secret-token-value');
  });

  it('rejects empty, whitespace-containing tokens or invalid platforms', async () => {
    await expect(
      service.register(actor, { token: '   ', platform: 'ios' }),
    ).rejects.toThrow(InvalidPushTokenException);

    await expect(
      service.register(actor, { token: 'bad token', platform: 'ios' }),
    ).rejects.toThrow(InvalidPushTokenException);

    await expect(
      service.register(actor, {
        token: 'valid-token',
        platform: 'web' as 'android',
      }),
    ).rejects.toThrow(InvalidPushTokenException);
  });

  it('unregisters only when token belongs to actor tenantId and userId', async () => {
    mockPrisma.deviceToken.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(
      service.unregister(actor, { token: 'my-token' }),
    ).resolves.toEqual({ unregistered: true });

    expect(mockPrisma.deviceToken.updateMany).toHaveBeenCalledWith({
      where: {
        token: 'my-token',
        tenantId: 'tenant-1',
        userId: 'user-1',
        isActive: true,
      },
      data: { isActive: false },
    });

    mockPrisma.deviceToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.unregister(actor, { token: 'other-users-token' }),
    ).resolves.toEqual({ unregistered: false });
  });
});
