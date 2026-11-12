jest.mock('../../config', () => ({
  envs: {
    tasksDatabaseUrl:
      'postgresql://tasks_svc:secret@localhost:5432/teamworkflow?schema=tasks',
  },
}));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

import { TaskExpirationJob } from './task-expiration.job';
import type { TasksPrismaService } from '../prisma/prisma.service';
import type { TasksEventsService } from '../events/tasks-events.service';

describe('TaskExpirationJob', () => {
  let job: TaskExpirationJob;
  let mockPrisma: any;
  let mockEvents: any;

  beforeEach(() => {
    mockPrisma = {
      task: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      tenantState: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    mockEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    job = new TaskExpirationJob(
      mockPrisma as unknown as TasksPrismaService,
      mockEvents as unknown as TasksEventsService,
    );
  });

  it('marks overdue pending tasks as EXPIRED and emits event', async () => {
    const now = new Date('2026-11-12T12:00:00Z');
    mockPrisma.task.findMany.mockResolvedValueOnce([
      {
        id: 'task-1',
        tenantId: 'tenant-1',
        status: 'PENDING',
        deadline: new Date('2026-11-12T11:00:00Z'),
        employeeId: 'emp-1',
        siteId: 'site-1',
      },
    ]);

    const count = await job.handleExpiration(now);

    expect(count).toBe(1);
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'EXPIRED' },
    });
    expect(mockEvents.publish).toHaveBeenCalledWith(
      'tenant-1',
      'task_expired',
      expect.objectContaining({ taskId: 'task-1' }),
    );
  });

  it('skips tasks belonging to suspended tenants', async () => {
    const now = new Date('2026-11-12T12:00:00Z');
    mockPrisma.task.findMany.mockResolvedValueOnce([
      {
        id: 'task-suspended',
        tenantId: 'tenant-suspended',
        status: 'PENDING',
        deadline: new Date('2026-11-12T11:00:00Z'),
      },
    ]);
    mockPrisma.tenantState.findMany.mockResolvedValueOnce([
      { tenantId: 'tenant-suspended', isSuspended: true },
    ]);

    const count = await job.handleExpiration(now);

    expect(count).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(mockEvents.publish).not.toHaveBeenCalled();
  });
});
