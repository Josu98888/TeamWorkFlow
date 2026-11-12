jest.mock('../../config', () => ({
  envs: {
    tasksDatabaseUrl:
      'postgresql://tasks_svc:secret@localhost:5432/teamworkflow?schema=tasks',
  },
}));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

import { ConsumedEventsProcessor } from './consumed-events.processor';
import type { TasksPrismaService } from '../prisma/prisma.service';
import type { TasksEventsService } from './tasks-events.service';
import type { StorageService } from '../media/storage.service';

describe('ConsumedEventsProcessor', () => {
  let processor: ConsumedEventsProcessor;
  let mockPrisma: any;
  let mockEvents: any;
  let mockStorage: any;

  beforeEach(() => {
    mockPrisma = {
      tenantFeatures: { findFirst: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
      tenantState: { findFirst: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
      taskTemplate: { findMany: jest.fn(), deleteMany: jest.fn() },
      task: {
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      media: { deleteMany: jest.fn() },
      taskAnswer: { deleteMany: jest.fn() },
      formVersion: { deleteMany: jest.fn() },
      form: { deleteMany: jest.fn() },
      processedEvent: { deleteMany: jest.fn() },
      $transaction: jest.fn().mockImplementation((fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
    };
    mockEvents = {
      registerHandler: jest.fn(),
      publish: jest.fn().mockResolvedValue(undefined),
    };
    mockStorage = {
      deleteObjectsByPrefix: jest.fn().mockResolvedValue(5),
    };

    processor = new ConsumedEventsProcessor(
      mockPrisma as unknown as TasksPrismaService,
      mockEvents as unknown as TasksEventsService,
      mockStorage as unknown as StorageService,
    );
  });

  it('registers handlers on module init', () => {
    processor.onModuleInit();
    expect(mockEvents.registerHandler).toHaveBeenCalledTimes(8);
  });

  it('generates per-shift tasks on shift_started when pro feature is active', async () => {
    mockPrisma.tenantFeatures.findFirst.mockResolvedValueOnce({
      features: { tasks: true },
    });
    mockPrisma.tenantState.findFirst.mockResolvedValueOnce(null);
    mockPrisma.taskTemplate.findMany.mockResolvedValueOnce([
      {
        id: 'tpl-1',
        formVersionId: 'ver-1',
        deadlineMode: 'AFTER_START',
        deadlineMinutes: 30,
        formVersion: { name: 'Ronda de Apertura' },
      },
    ]);
    mockPrisma.task.findFirst.mockResolvedValueOnce(null);
    mockPrisma.task.create.mockResolvedValueOnce({
      id: 'task-gen-1',
      title: 'Ronda de Apertura',
      deadline: new Date('2026-11-12T08:30:00Z'),
    });

    await processor.handleShiftStarted({
      subject: 't.tenant-1.organization.shift_started',
      tenantId: 'tenant-1',
      payload: {
        eventId: '019323ea-3d3a-7347-8fae-c0498b584099',
        shiftId: 'shift-1',
        siteId: 'site-1',
        postId: 'post-1',
        employeeId: 'emp-1',
        start: '2026-11-12T08:00:00.000Z',
        end: '2026-11-12T16:00:00.000Z',
      },
    });

    expect(mockPrisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        kind: 'PER_SHIFT',
        shiftId: 'shift-1',
      }),
    });
    expect(mockEvents.publish).toHaveBeenCalledWith(
      'tenant-1',
      'task_assigned',
      expect.anything(),
    );
  });

  it('cancels pending per-shift tasks on shift_cancelled', async () => {
    await processor.handleShiftCancelled({
      subject: 't.tenant-1.organization.shift_cancelled',
      tenantId: 'tenant-1',
      payload: { shiftId: 'shift-1' },
    });

    expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        shiftId: 'shift-1',
        status: 'PENDING',
      },
      data: { status: 'CANCELLED' },
    });
  });

  it('purges S3 photos first and then database rows on data_retention_expired', async () => {
    await processor.handleDataRetentionExpired({
      subject: 't.tenant-1.billing.data_retention_expired',
      tenantId: 'tenant-1',
      payload: {},
    });

    expect(mockStorage.deleteObjectsByPrefix).toHaveBeenCalledWith('tenant-1/');
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });
});
