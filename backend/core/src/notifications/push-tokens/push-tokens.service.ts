import { Injectable } from '@nestjs/common';
import { InvalidPushTokenException } from '../../common/exceptions/app.exceptions';
import { DevicePlatform } from '../prisma/generated/client';
import { NotificationsPrismaService } from '../prisma/prisma.service';

export interface NotificationActor {
  tenantId: string;
  userId: string;
  role?: string;
}

export type PushPlatform = 'android' | 'ios';

export interface RegisterPushTokenInput {
  token: string;
  platform: PushPlatform;
}

export interface UnregisterPushTokenInput {
  token: string;
}

export interface RegisteredDeviceSummary {
  id: string;
  platform: PushPlatform;
  isActive: boolean;
  lastSeenAt: string;
}

function normalizeToken(raw: string): string {
  if (typeof raw !== 'string') {
    throw new InvalidPushTokenException('Push token must be a string');
  }
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    throw new InvalidPushTokenException('Push token is invalid');
  }
  return trimmed;
}

function toPrismaPlatform(platform: string): DevicePlatform {
  const normalized = platform?.trim().toLowerCase();
  if (normalized === 'android') {
    return DevicePlatform.ANDROID;
  }
  if (normalized === 'ios') {
    return DevicePlatform.IOS;
  }
  throw new InvalidPushTokenException('Push platform must be android or ios');
}

function fromPrismaPlatform(platform: DevicePlatform): PushPlatform {
  return platform === DevicePlatform.IOS ? 'ios' : 'android';
}

@Injectable()
export class PushTokensService {
  constructor(private readonly prisma: NotificationsPrismaService) {}

  async register(
    actor: NotificationActor,
    input: RegisterPushTokenInput,
  ): Promise<RegisteredDeviceSummary> {
    const token = normalizeToken(input.token);
    const platform = toPrismaPlatform(input.platform);
    const now = new Date();

    const record = await this.prisma.deviceToken.upsert({
      where: { token },
      update: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        platform,
        isActive: true,
        lastSeenAt: now,
      },
      create: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        token,
        platform,
        isActive: true,
        lastSeenAt: now,
      },
    });

    return {
      id: record.id,
      platform: fromPrismaPlatform(record.platform),
      isActive: record.isActive,
      lastSeenAt: record.lastSeenAt.toISOString(),
    };
  }

  async unregister(
    actor: NotificationActor,
    input: UnregisterPushTokenInput,
  ): Promise<{ unregistered: boolean }> {
    const token = normalizeToken(input.token);

    const result = await this.prisma.deviceToken.updateMany({
      where: {
        token,
        tenantId: actor.tenantId,
        userId: actor.userId,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    return { unregistered: result.count > 0 };
  }
}
