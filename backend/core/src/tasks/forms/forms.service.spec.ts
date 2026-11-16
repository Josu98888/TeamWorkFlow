jest.mock('../../config', () => ({
  envs: {
    tasksDatabaseUrl:
      'postgresql://tasks_svc:secret@localhost:5432/teamworkflow?schema=tasks',
  },
}));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

import { FormNotFoundException } from '../../common/exceptions/app.exceptions';
import { FormsService, type FormActor } from './forms.service';
import type { TasksPrismaService } from '../prisma/prisma.service';

describe('FormsService', () => {
  let service: FormsService;
  let mockPrisma: {
    form: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    formVersion: {
      create: jest.Mock;
    };
  };

  const actor: FormActor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'admin',
  };

  beforeEach(() => {
    mockPrisma = {
      form: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      formVersion: {
        create: jest.fn(),
      },
    };

    service = new FormsService(mockPrisma as unknown as TasksPrismaService);
  });

  it('creates draft form', async () => {
    const fields = [{ key: 'title', label: 'Titulo', type: 'text' as const, required: true }];
    mockPrisma.form.create.mockResolvedValue({ id: 'form-1', name: 'Form 1', draftFields: fields });

    const result = await service.create(actor, { name: 'Form 1', fields });

    expect(result.id).toBe('form-1');
    expect(mockPrisma.form.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: actor.tenantId,
        name: 'Form 1',
        createdBy: actor.userId,
      }),
    });
  });

  it('updates draft form and enforces tenant isolation', async () => {
    mockPrisma.form.findFirst.mockResolvedValueOnce(null);
    await expect(service.update(actor, 'missing-id', { name: 'New' })).rejects.toThrow(
      FormNotFoundException,
    );

    mockPrisma.form.findFirst.mockResolvedValueOnce({ id: 'form-1', tenantId: actor.tenantId });
    mockPrisma.form.update.mockResolvedValueOnce({ id: 'form-1', name: 'New Name' });

    const updated = await service.update(actor, 'form-1', { name: 'New Name' });
    expect(updated.name).toBe('New Name');
  });

  it('publishes form version incrementing version number', async () => {
    mockPrisma.form.findFirst.mockResolvedValueOnce({
      id: 'form-1',
      tenantId: actor.tenantId,
      name: 'Ronda de Seguridad',
      draftFields: [{ key: 'chk', label: 'Check', type: 'yes_no', required: true }],
      versions: [{ version: 1 }],
    });

    mockPrisma.formVersion.create.mockResolvedValueOnce({
      id: 'ver-2',
      formId: 'form-1',
      version: 2,
    });

    const published = await service.publish(actor, 'form-1');

    expect(published.version).toBe(2);
    expect(mockPrisma.formVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 2,
        formId: 'form-1',
        publishedBy: actor.userId,
      }),
    });
  });

  it('lists forms for tenant with pagination', async () => {
    mockPrisma.form.findMany.mockResolvedValueOnce([{ id: 'f1' }, { id: 'f2' }]);
    mockPrisma.form.count.mockResolvedValueOnce(2);

    const result = await service.list(actor, 1, 10);

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(mockPrisma.form.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: actor.tenantId } }),
    );
  });
});
