jest.mock('../../config', () => ({
  envs: {
    tasksDatabaseUrl:
      'postgresql://tasks_svc:secret@localhost:5432/teamworkflow?schema=tasks',
  },
}));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

import { FormNotPublishedException } from '../../common/exceptions/app.exceptions';
import { TaskTemplatesService, type TemplateActor } from './task-templates.service';
import type { TasksPrismaService } from '../prisma/prisma.service';

describe('TaskTemplatesService', () => {
  let service: TaskTemplatesService;
  let mockPrisma: {
    formVersion: {
      findFirst: jest.Mock;
    };
    taskTemplate: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
  };

  const actor: TemplateActor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'admin',
  };

  beforeEach(() => {
    mockPrisma = {
      formVersion: {
        findFirst: jest.Mock = jest.fn(),
      },
      taskTemplate: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };

    service = new TaskTemplatesService(mockPrisma as unknown as TasksPrismaService);
  });

  it('creates task template after verifying form version is published', async () => {
    mockPrisma.formVersion.findFirst.mockResolvedValueOnce({
      id: 'ver-1',
      tenantId: actor.tenantId,
    });
    mockPrisma.taskTemplate.create.mockResolvedValueOnce({
      id: 'tpl-1',
      siteId: 'site-1',
      postId: 'post-1',
    });

    const result = await service.create(actor, {
      siteId: 'site-1',
      postId: 'post-1',
      formVersionId: 'ver-1',
      deadlineMode: 'AFTER_START',
      deadlineMinutes: 60,
    });

    expect(result.id).toBe('tpl-1');
    expect(mockPrisma.taskTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: actor.tenantId,
        siteId: 'site-1',
        postId: 'post-1',
        formVersionId: 'ver-1',
      }),
    });
  });

  it('rejects creation when form version is not published or belongs to another tenant', async () => {
    mockPrisma.formVersion.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.create(actor, {
        siteId: 'site-1',
        postId: 'post-1',
        formVersionId: 'missing-ver',
        deadlineMode: 'AT_SHIFT_END',
      }),
    ).rejects.toThrow(FormNotPublishedException);
  });

  it('lists task templates with optional site and post filtering', async () => {
    mockPrisma.taskTemplate.findMany.mockResolvedValueOnce([{ id: 'tpl-1' }]);

    const list = await service.list(actor, { siteId: 'site-1', postId: 'post-1' });

    expect(list).toHaveLength(1);
    expect(mockPrisma.taskTemplate.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: actor.tenantId,
        siteId: 'site-1',
        postId: 'post-1',
      },
      orderBy: { createdAt: 'desc' },
      include: { formVersion: true },
    });
  });
});
