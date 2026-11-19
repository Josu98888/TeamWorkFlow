jest.mock('../config', () => ({
  envs: {
    tasksDatabaseUrl:
      'postgresql://tasks_svc:secret@localhost:5432/teamworkflow?schema=tasks',
  },
}));
jest.mock('./prisma/generated/client', () => ({ PrismaClient: class {} }));
jest.mock('../organization/prisma/generated/client', () => ({
  PrismaClient: class {},
}));

import { TasksService } from './tasks.service';

describe('TasksService (Facade)', () => {
  let service: TasksService;
  let mockForms: any;
  let mockTemplates: any;
  let mockMedia: any;
  let mockTasks: any;

  const actor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'owner',
  };

  beforeEach(() => {
    mockForms = {
      create: jest.fn().mockResolvedValue({ id: 'form-1' }),
      update: jest.fn().mockResolvedValue({ id: 'form-1' }),
      publish: jest.fn().mockResolvedValue({ id: 'ver-1' }),
      get: jest.fn().mockResolvedValue({ id: 'form-1' }),
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };

    mockTemplates = {
      create: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
      update: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
      list: jest.fn().mockResolvedValue([]),
    };

    mockMedia = {
      requestUpload: jest.fn().mockResolvedValue({ uploadUrl: 'http://upload' }),
      getUrl: jest.fn().mockResolvedValue({ url: 'http://get' }),
    };

    mockTasks = {
      create: jest.fn().mockResolvedValue({ id: 'task-1' }),
      get: jest.fn().mockResolvedValue({ id: 'task-1' }),
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      claim: jest.fn().mockResolvedValue({ id: 'task-1' }),
      answer: jest.fn().mockResolvedValue({ id: 'task-1' }),
      review: jest.fn().mockResolvedValue({ id: 'task-1' }),
    };

    service = new TasksService(mockForms, mockTemplates, mockMedia, mockTasks);
  });

  it('delegates form operations to FormsService', async () => {
    await service.formCreate(actor, { name: 'F', fields: [] });
    expect(mockForms.create).toHaveBeenCalledWith(actor, { name: 'F', fields: [] });

    await service.formPublish(actor, 'f-1');
    expect(mockForms.publish).toHaveBeenCalledWith(actor, 'f-1');
  });

  it('delegates template operations to TaskTemplatesService', async () => {
    await service.taskTemplateList(actor);
    expect(mockTemplates.list).toHaveBeenCalledWith(actor, undefined);
  });

  it('delegates media operations to MediaService', async () => {
    await service.mediaGetUrl(actor, 'm-1');
    expect(mockMedia.getUrl).toHaveBeenCalledWith(actor, 'm-1');
  });

  it('delegates task management operations to TaskManagementService', async () => {
    await service.taskClaim(actor, 't-1');
    expect(mockTasks.claim).toHaveBeenCalledWith(actor, 't-1');
  });
});
