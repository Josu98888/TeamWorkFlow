import { Injectable, NotFoundException } from '@nestjs/common';
import { FormNotPublishedException } from '../../common/exceptions/app.exceptions';
import { TasksPrismaService } from '../prisma/prisma.service';
import type { DeadlineMode } from '../prisma/generated/client';

export interface CreateTaskTemplateDto {
  siteId: string;
  postId: string;
  formVersionId: string;
  deadlineMode: DeadlineMode;
  deadlineMinutes?: number | null;
}

export interface UpdateTaskTemplateDto {
  formVersionId?: string;
  deadlineMode?: DeadlineMode;
  deadlineMinutes?: number | null;
  isActive?: boolean;
}

export interface TemplateActor {
  userId: string;
  tenantId: string;
  role: string;
}

@Injectable()
export class TaskTemplatesService {
  constructor(private readonly prisma: TasksPrismaService) {}

  async create(actor: TemplateActor, dto: CreateTaskTemplateDto) {
    const version = await this.prisma.formVersion.findFirst({
      where: {
        id: dto.formVersionId,
        tenantId: actor.tenantId,
      },
    });

    if (!version) {
      throw new FormNotPublishedException();
    }

    return this.prisma.taskTemplate.create({
      data: {
        tenantId: actor.tenantId,
        siteId: dto.siteId,
        postId: dto.postId,
        formVersionId: dto.formVersionId,
        deadlineMode: dto.deadlineMode,
        deadlineMinutes: dto.deadlineMinutes ?? null,
        isActive: true,
      },
    });
  }

  async update(actor: TemplateActor, id: string, dto: UpdateTaskTemplateDto) {
    const template = await this.prisma.taskTemplate.findFirst({
      where: { id, tenantId: actor.tenantId },
    });

    if (!template) {
      throw new NotFoundException('Task template not found');
    }

    if (dto.formVersionId) {
      const version = await this.prisma.formVersion.findFirst({
        where: {
          id: dto.formVersionId,
          tenantId: actor.tenantId,
        },
      });

      if (!version) {
        throw new FormNotPublishedException();
      }
    }

    return this.prisma.taskTemplate.update({
      where: { id },
      data: {
        formVersionId: dto.formVersionId,
        deadlineMode: dto.deadlineMode,
        deadlineMinutes: dto.deadlineMinutes,
        isActive: dto.isActive,
      },
    });
  }

  async list(actor: TemplateActor, filters?: { siteId?: string; postId?: string }) {
    const where: { tenantId: string; siteId?: string; postId?: string } = {
      tenantId: actor.tenantId,
    };

    if (filters?.siteId) {
      where.siteId = filters.siteId;
    }
    if (filters?.postId) {
      where.postId = filters.postId;
    }

    return this.prisma.taskTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        formVersion: true,
      },
    });
  }
}
