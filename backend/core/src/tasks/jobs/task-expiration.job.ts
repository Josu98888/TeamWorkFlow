import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TasksPrismaService } from '../prisma/prisma.service';
import { TasksEventsService } from '../events/tasks-events.service';
import { TASKS_EVENTS } from '../events/tasks.events';

@Injectable()
export class TaskExpirationJob {
  private readonly logger = new Logger(TaskExpirationJob.name);

  constructor(
    private readonly prisma: TasksPrismaService,
    private readonly events: TasksEventsService,
  ) {}

  @Cron('*/5 * * * *')
  async handleExpiration(now: Date = new Date()): Promise<number> {
    const overdueTasks = await this.prisma.task.findMany({
      where: {
        status: 'PENDING',
        deadline: { lte: now },
      },
    });

    if (overdueTasks.length === 0) {
      return 0;
    }

    // Get suspended tenants to skip them
    const suspendedStates = await this.prisma.tenantState.findMany({
      where: { isSuspended: true },
    });
    const suspendedTenantIds = new Set(suspendedStates.map((s) => s.tenantId));

    let expiredCount = 0;

    for (const task of overdueTasks) {
      if (suspendedTenantIds.has(task.tenantId)) {
        continue;
      }

      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'EXPIRED' },
      });

      await this.events.publish(task.tenantId, TASKS_EVENTS.taskExpired, {
        tenantId: task.tenantId,
        taskId: task.id,
        employeeId: task.employeeId,
        siteId: task.siteId,
      });

      expiredCount++;
    }

    if (expiredCount > 0) {
      this.logger.log(`Expired ${expiredCount} tasks overdue as of ${now.toISOString()}`);
    }

    return expiredCount;
  }
}
