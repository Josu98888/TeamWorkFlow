import { Injectable } from '@nestjs/common';
import { NotificationNotFoundException } from '../../common/exceptions/app.exceptions';
import { NotificationsPrismaService } from '../prisma/prisma.service';
import type { NotificationActor } from '../push-tokens/push-tokens.service';

export interface ListNotificationsInput {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}

export interface NotificationItemDto {
  id: string;
  templateCode: string;
  locale: string;
  title: string;
  body: string;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface ListNotificationsResult {
  items: NotificationItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MarkReadInput {
  notificationId?: string;
  all?: boolean;
}

export interface MarkReadResult {
  updatedCount: number;
  id?: string;
  readAt?: string;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class InAppNotificationsService {
  constructor(private readonly prisma: NotificationsPrismaService) {}

  async list(
    actor: NotificationActor,
    input: ListNotificationsInput = {},
  ): Promise<ListNotificationsResult> {
    const page = Math.max(1, Math.trunc(input.page ?? DEFAULT_PAGE));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(input.pageSize ?? DEFAULT_PAGE_SIZE)),
    );
    const skip = (page - 1) * pageSize;

    const where = {
      tenantId: actor.tenantId,
      userId: actor.userId,
      ...(input.unreadOnly ? { readAt: null } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        templateCode: row.templateCode,
        locale: row.locale,
        title: row.title,
        body: row.body,
        data: row.data ?? null,
        readAt: row.readAt ? row.readAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async unreadCount(actor: NotificationActor): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        readAt: null,
      },
    });
    return { count };
  }

  async markRead(
    actor: NotificationActor,
    input: MarkReadInput,
  ): Promise<MarkReadResult> {
    const now = new Date();

    if (input.all) {
      const result = await this.prisma.notification.updateMany({
        where: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          readAt: null,
        },
        data: { readAt: now },
      });
      return { updatedCount: result.count };
    }

    if (!input.notificationId) {
      throw new NotificationNotFoundException();
    }

    const existing = await this.prisma.notification.findFirst({
      where: {
        id: input.notificationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
      },
    });

    if (!existing) {
      throw new NotificationNotFoundException();
    }

    if (existing.readAt) {
      return {
        updatedCount: 0,
        id: existing.id,
        readAt: existing.readAt.toISOString(),
      };
    }

    const updated = await this.prisma.notification.updateMany({
      where: {
        id: existing.id,
        tenantId: actor.tenantId,
        userId: actor.userId,
        readAt: null,
      },
      data: { readAt: now },
    });

    return {
      updatedCount: updated.count,
      id: existing.id,
      readAt: now.toISOString(),
    };
  }
}
