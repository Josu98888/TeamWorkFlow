import { Injectable } from '@nestjs/common';
import {
  FeatureNotInPlanException,
  ForbiddenException,
  FormNotPublishedException,
  NoShiftInProgressException,
  TaskAlreadyClaimedException,
  TaskNotFoundException,
  TaskNotOpenException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import { OrganizationService } from '../../organization/organization.service';
import { validateTaskAnswers } from '../domain/answer-validator';
import type { FormFieldDefinition } from '../domain/form-validator';
import { MediaService } from '../media/media.service';
import { TasksPrismaService } from '../prisma/prisma.service';
import { TasksEventsService } from '../events/tasks-events.service';
import { TASKS_EVENTS } from '../events/tasks.events';
import type { ReviewResult, TaskKind, TaskStatus } from '../prisma/generated/client';

export interface TaskActor {
  userId: string;
  tenantId: string;
  role: string;
  siteIds?: string[];
}

export interface CreateTaskDto {
  formVersionId: string;
  deadline: string | Date;
  employeeId?: string | null;
  siteId: string;
  postId: string;
  expectedQr?: string | null;
  title?: string;
}

export interface AnswerTaskDto {
  taskId: string;
  clientAnswerId: string;
  deviceTime: string | Date;
  answers: Record<string, unknown>;
}

export interface ReviewTaskDto {
  result: 'APPROVED' | 'OBSERVED';
  note?: string;
}

export interface ListTasksQuery {
  status?: TaskStatus;
  employeeId?: string;
  siteId?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class TaskManagementService {
  constructor(
    private readonly prisma: TasksPrismaService,
    private readonly mediaService: MediaService,
    private readonly eventsService: TasksEventsService,
    private readonly organizationService: OrganizationService,
  ) {}

  async create(actor: TaskActor, dto: CreateTaskDto) {
    await this.assertTasksFeature(actor.tenantId);

    if (actor.role === 'supervisor') {
      if (!actor.siteIds || !actor.siteIds.includes(dto.siteId)) {
        throw new ForbiddenException();
      }
    }

    const version = await this.prisma.formVersion.findFirst({
      where: { id: dto.formVersionId, tenantId: actor.tenantId },
    });

    if (!version) {
      throw new FormNotPublishedException();
    }

    const task = await this.prisma.task.create({
      data: {
        tenantId: actor.tenantId,
        kind: 'SINGLE',
        status: 'PENDING',
        formVersionId: dto.formVersionId,
        title: dto.title ?? version.name,
        deadline: new Date(dto.deadline),
        employeeId: dto.employeeId ?? null,
        siteId: dto.siteId,
        postId: dto.postId,
        expectedQr: dto.expectedQr ?? null,
        createdBy: actor.userId,
      },
    });

    await this.eventsService.publish(actor.tenantId, TASKS_EVENTS.taskAssigned, {
      tenantId: actor.tenantId,
      taskId: task.id,
      employeeId: task.employeeId,
      siteId: task.siteId,
      postId: task.postId,
      shiftId: null,
      title: task.title,
      deadline: task.deadline.toISOString(),
    });

    return task;
  }

  async get(actor: TaskActor, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, tenantId: actor.tenantId },
      include: {
        formVersion: true,
        answer: true,
      },
    });

    if (!task) {
      throw new TaskNotFoundException();
    }

    if (actor.role === 'supervisor') {
      if (!actor.siteIds || !actor.siteIds.includes(task.siteId)) {
        throw new TaskNotFoundException();
      }
    }

    if (actor.role === 'employee') {
      const employee = await this.resolveEmployee(actor);
      if (task.employeeId !== null && task.employeeId !== employee?.id) {
        throw new TaskNotFoundException();
      }
    }

    return task;
  }

  async list(actor: TaskActor, query: ListTasksQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {
      tenantId: actor.tenantId,
    };

    if (query.status) {
      where.status = query.status;
    }
    if (query.siteId) {
      where.siteId = query.siteId;
    }
    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (actor.role === 'supervisor') {
      where.siteId = { in: actor.siteIds ?? [] };
    } else if (actor.role === 'employee') {
      const employee = await this.resolveEmployee(actor);
      where.OR = [
        { employeeId: employee?.id },
        { employeeId: null },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: { deadline: 'asc' },
        skip,
        take: pageSize,
        include: { formVersion: true, answer: true },
      }),
      this.prisma.task.count({ where }),
    ]);

    return { items, total };
  }

  async claim(actor: TaskActor, taskId: string) {
    const employee = await this.resolveEmployee(actor);
    if (!employee) {
      throw new NoShiftInProgressException();
    }

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, tenantId: actor.tenantId },
    });

    if (!task) {
      throw new TaskNotFoundException();
    }

    if (task.status !== 'PENDING') {
      throw new TaskNotOpenException();
    }

    if (task.employeeId === employee.id) {
      return task;
    }

    if (task.employeeId !== null) {
      throw new TaskAlreadyClaimedException();
    }

    await this.assertShiftInProgress(actor, employee.id, task.siteId, task.postId);

    const updated = await this.prisma.task.updateMany({
      where: {
        id: taskId,
        tenantId: actor.tenantId,
        employeeId: null,
        status: 'PENDING',
      },
      data: {
        employeeId: employee.id,
        claimedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new TaskAlreadyClaimedException();
    }

    return this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  }

  async answer(actor: TaskActor, dto: AnswerTaskDto) {
    const employee = await this.resolveEmployee(actor);
    if (!employee) {
      throw new NoShiftInProgressException();
    }

    const existingAnswer = await this.prisma.taskAnswer.findFirst({
      where: {
        tenantId: actor.tenantId,
        clientAnswerId: dto.clientAnswerId,
      },
      include: { task: true },
    });

    if (existingAnswer) {
      return existingAnswer.task;
    }

    const task = await this.prisma.task.findFirst({
      where: { id: dto.taskId, tenantId: actor.tenantId },
      include: { formVersion: true },
    });

    if (!task) {
      throw new TaskNotFoundException();
    }

    if (task.status !== 'PENDING') {
      throw new TaskNotOpenException();
    }

    if (task.employeeId === null) {
      await this.assertShiftInProgress(actor, employee.id, task.siteId, task.postId);
    } else if (task.employeeId !== employee.id) {
      throw new TaskAlreadyClaimedException();
    }

    const formFields = task.formVersion.fields as unknown as FormFieldDefinition[];
    const validatedAnswers = validateTaskAnswers({
      submittedAnswers: dto.answers,
      formFields,
      expectedQr: task.expectedQr,
      deviceTime: new Date(dto.deviceTime),
      now: new Date(),
    });

    for (const field of formFields) {
      if (field.type === 'photo') {
        const mediaId = validatedAnswers[field.key] as string;
        if (mediaId) {
          await this.mediaService.verifyMediaForAnswer(
            actor.tenantId,
            actor.userId,
            mediaId,
          );
        }
      }
    }

    const completedTask = await this.prisma.$transaction(async (tx) => {
      await tx.taskAnswer.create({
        data: {
          tenantId: actor.tenantId,
          taskId: task.id,
          formVersionId: task.formVersionId,
          answers: validatedAnswers as object,
          clientAnswerId: dto.clientAnswerId,
          deviceTime: new Date(dto.deviceTime),
          submittedByUserId: actor.userId,
          reviewResult: 'NONE',
        },
      });

      return tx.task.update({
        where: { id: task.id },
        data: {
          status: 'COMPLETED',
          employeeId: employee.id,
          claimedAt: task.claimedAt ?? new Date(),
        },
        include: { answer: true },
      });
    });

    await this.eventsService.publish(actor.tenantId, TASKS_EVENTS.taskCompleted, {
      tenantId: actor.tenantId,
      taskId: completedTask.id,
      employeeId: employee.id,
      siteId: completedTask.siteId,
    });

    return completedTask;
  }

  async review(actor: TaskActor, taskId: string, dto: ReviewTaskDto) {
    if (dto.result === 'OBSERVED' && (!dto.note || dto.note.trim() === '')) {
      throw new ValidationException([
        { field: 'note', constraints: ['Note is mandatory when observing an answer'] },
      ]);
    }

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, tenantId: actor.tenantId },
      include: { answer: true },
    });

    if (!task || !task.answer) {
      throw new TaskNotFoundException();
    }

    if (actor.role === 'supervisor') {
      if (!actor.siteIds || !actor.siteIds.includes(task.siteId)) {
        throw new TaskNotFoundException();
      }
    }

    const reviewResult: ReviewResult = dto.result;

    await this.prisma.taskAnswer.update({
      where: { id: task.answer.id },
      data: {
        reviewResult,
        reviewNote: dto.note?.trim() ?? null,
        reviewedBy: actor.userId,
        reviewedAt: new Date(),
      },
    });

    return this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { answer: true },
    });
  }

  private async assertTasksFeature(tenantId: string) {
    const features = await this.prisma.tenantFeatures.findFirst({
      where: { tenantId },
    });

    const hasTasks =
      features &&
      typeof features.features === 'object' &&
      features.features !== null &&
      (features.features as Record<string, boolean>).tasks === true;

    if (!hasTasks) {
      throw new FeatureNotInPlanException();
    }
  }

  private async resolveEmployee(actor: TaskActor) {
    try {
      return await this.organizationService.getEmployeeForTenant(actor.tenantId, {
        userId: actor.userId,
      });
    } catch {
      return null;
    }
  }

  private async assertShiftInProgress(
    actor: TaskActor,
    employeeId: string,
    siteId: string,
    postId: string,
  ) {
    try {
      const shifts = await this.organizationService.listShifts(
        {
          userId: actor.userId,
          tenantId: actor.tenantId,
          role: actor.role as any,
          siteIds: actor.siteIds,
        },
        {
          employeeId,
          siteId,
          status: 'in_progress',
        } as any,
      );

      const hasMatchingShift = shifts.items.some(
        (shift: any) => shift.postId === postId && shift.status === 'in_progress',
      );

      if (!hasMatchingShift) {
        throw new NoShiftInProgressException();
      }
    } catch (err) {
      if (err instanceof NoShiftInProgressException) throw err;
      throw new NoShiftInProgressException();
    }
  }
}
