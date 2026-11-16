jest.mock('../../config', () => ({
  envs: {
    tasksDatabaseUrl:
      'postgresql://tasks_svc:secret@localhost:5432/teamworkflow?schema=tasks',
  },
}));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));
jest.mock('../../organization/prisma/generated/client', () => ({
  PrismaClient: class {},
}));

import {
  FeatureNotInPlanException,
  NoShiftInProgressException,
  TaskAlreadyClaimedException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import {
  TaskManagementService,
  type TaskActor,
} from './task-management.service';
import type { TasksPrismaService } from '../prisma/prisma.service';
import type { MediaVerificationService } from '../media/media-verification.service';
import type { TasksEventsService } from '../events/tasks-events.service';
import type { OrganizationService } from '../../organization/organization.service';

describe('TaskManagementService', () => {
  let service: TaskManagementService;
  let mockPrisma: any;
  let mockMedia: any;
  let mockEvents: any;
  let mockOrg: any;

  const adminActor: TaskActor = {
    userId: 'admin-1',
    tenantId: 'tenant-1',
    role: 'admin',
  };

  const employeeActor: TaskActor = {
    userId: 'emp-user-1',
    tenantId: 'tenant-1',
    role: 'employee',
  };

  beforeEach(() => {
    mockPrisma = {
      tenantFeatures: { findFirst: jest.fn() },
      formVersion: { findFirst: jest.fn() },
      task: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      taskAnswer: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
    };

    mockMedia = {
      verifyMediaForAnswer: jest.fn().mockResolvedValue(undefined),
    };

    mockEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    mockOrg = {
      getEmployeeForTenant: jest.fn().mockResolvedValue({ id: 'emp-1', userId: 'emp-user-1' }),
      listShifts: jest.fn().mockResolvedValue({
        items: [{ id: 'shift-1', postId: 'post-1', status: 'IN_PROGRESS' }],
      }),
    };

    service = new TaskManagementService(
      mockPrisma as unknown as TasksPrismaService,
      mockMedia as unknown as MediaVerificationService,
      mockEvents as unknown as TasksEventsService,
      mockOrg as unknown as OrganizationService,
    );
  });

  it('creates task when tenant has tasks feature', async () => {
    mockPrisma.tenantFeatures.findFirst.mockResolvedValueOnce({
      features: { tasks: true },
    });
    mockPrisma.formVersion.findFirst.mockResolvedValueOnce({
      id: 'ver-1',
      name: 'Ronda',
    });
    mockPrisma.task.create.mockResolvedValueOnce({
      id: 'task-1',
      tenantId: 'tenant-1',
      title: 'Ronda',
      status: 'PENDING',
      deadline: new Date('2026-11-12T15:00:00Z'),
      employeeId: null,
      siteId: 'site-1',
      postId: 'post-1',
    });

    const task = await service.create(adminActor, {
      formVersionId: 'ver-1',
      deadline: '2026-11-12T15:00:00Z',
      siteId: 'site-1',
      postId: 'post-1',
    });

    expect(task.id).toBe('task-1');
    expect(mockEvents.publish).toHaveBeenCalledWith(
      'tenant-1',
      'task_assigned',
      expect.objectContaining({ taskId: 'task-1' }),
    );
  });

  it('rejects task creation if tenant lacks tasks feature', async () => {
    mockPrisma.tenantFeatures.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.create(adminActor, {
        formVersionId: 'ver-1',
        deadline: '2026-11-12T15:00:00Z',
        siteId: 'site-1',
        postId: 'post-1',
      }),
    ).rejects.toThrow(FeatureNotInPlanException);
  });

  it('claims an unassigned site/post task if shift is in progress', async () => {
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      employeeId: null,
      siteId: 'site-1',
      postId: 'post-1',
    });
    mockPrisma.task.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.task.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'task-1',
      employeeId: 'emp-1',
    });

    const claimed = await service.claim(employeeActor, 'task-1');

    expect(claimed.employeeId).toBe('emp-1');
    expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        tenantId: 'tenant-1',
        employeeId: null,
        status: 'PENDING',
      },
      data: expect.objectContaining({ employeeId: 'emp-1' }),
    });
  });

  it('rejects claim with TaskAlreadyClaimedException if another employee claimed first', async () => {
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      employeeId: 'other-emp',
      siteId: 'site-1',
      postId: 'post-1',
    });

    await expect(service.claim(employeeActor, 'task-1')).rejects.toThrow(
      TaskAlreadyClaimedException,
    );
  });

  it('rejects claim with NoShiftInProgressException if employee has no active shift', async () => {
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      employeeId: null,
      siteId: 'site-1',
      postId: 'post-1',
    });
    mockOrg.listShifts.mockResolvedValueOnce({
      items: [{ id: 'shift-2', postId: 'post-1', status: 'SCHEDULED' }],
    });

    await expect(service.claim(employeeActor, 'task-1')).rejects.toThrow(
      NoShiftInProgressException,
    );
    expect(mockOrg.listShifts).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'emp-user-1',
      }),
      {
        employeeId: 'emp-1',
        siteId: 'site-1',
        pageSize: 100,
      },
    );
  });

  it('answers task and completes it in transaction', async () => {
    mockPrisma.taskAnswer.findFirst.mockResolvedValueOnce(null);
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      employeeId: 'emp-1',
      siteId: 'site-1',
      postId: 'post-1',
      formVersionId: 'ver-1',
      formVersion: {
        fields: [{ key: 'status_check', label: 'Estado', type: 'yes_no', required: true }],
      },
    });
    mockPrisma.task.update.mockResolvedValueOnce({
      id: 'task-1',
      status: 'COMPLETED',
      siteId: 'site-1',
    });

    const completed = await service.answer(employeeActor, {
      taskId: 'task-1',
      clientAnswerId: 'ans-uuid-1',
      deviceTime: new Date(),
      answers: { status_check: true },
    });

    expect(completed.status).toBe('COMPLETED');
    expect(mockEvents.publish).toHaveBeenCalledWith(
      'tenant-1',
      'task_completed',
      expect.objectContaining({ taskId: 'task-1' }),
    );
  });

  it('reviews task and requires note for OBSERVED', async () => {
    await expect(
      service.review(adminActor, 'task-1', { result: 'OBSERVED', note: '' }),
    ).rejects.toThrow(ValidationException);

    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task-1',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      answer: { id: 'ans-1' },
    });
    mockPrisma.task.findUniqueOrThrow.mockResolvedValueOnce({ id: 'task-1' });

    const reviewed = await service.review(adminActor, 'task-1', {
      result: 'APPROVED',
    });

    expect(reviewed.id).toBe('task-1');
    expect(mockPrisma.taskAnswer.update).toHaveBeenCalledWith({
      where: { id: 'ans-1' },
      data: expect.objectContaining({ reviewResult: 'APPROVED' }),
    });
  });
});
