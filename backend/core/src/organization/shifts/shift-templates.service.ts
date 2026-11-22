import { Injectable } from '@nestjs/common';
import {
  EmployeeNotFoundException,
  PostNotFoundException,
  ShiftTemplateNotFoundException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import { envs } from '../../config';
import { EmployeesService } from '../employees/employees.service';
import { OrganizationEventsService } from '../events/organization-events.service';
import type { OrganizationActor } from '../organization-actor';
import { ORGANIZATION_EVENTS } from '../organization.patterns';
import { OrganizationPrismaService } from '../prisma/prisma.service';
import { PostsService } from '../sites/posts.service';
import { canAccessSite, requireSiteManager, requireTenantActor } from '../sites/site-policy';
import { SitesService, type PageResult } from '../sites/sites.service';
import type {
  CreateShiftTemplateBodyDto,
  ListShiftTemplatesQueryDto,
  UpdateShiftTemplateBodyDto,
} from './dto/shift-template.dto';
import {
  addCalendarDays,
  isoWeekday,
  localCalendarDay,
  templateShiftWindow,
} from './template-schedule';

const DEFAULT_HORIZON_DAYS = 14;
const CRON_BATCH_SIZE = 200;

interface ShiftTemplateRow {
  id: string;
  tenantId: string;
  siteId: string;
  postId: string;
  employeeId: string | null;
  weekdays: number[];
  startTime: string;
  durationMinutes: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface GenerationContextRow extends ShiftTemplateRow {
  site: { id: string; timezone: string; isActive: boolean };
  post: { id: string; isActive: boolean };
  employee: { id: string; isActive: boolean } | null;
}

export interface ShiftTemplateView {
  id: string;
  tenantId: string;
  siteId: string;
  postId: string;
  employeeId: string | null;
  weekdays: number[];
  startTime: string;
  durationMinutes: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShiftTemplateWithGeneration {
  template: ShiftTemplateView;
  generatedCount: number;
  skippedOverlapCount: number;
}

export interface ShiftGenerationSummary {
  templatesProcessed: number;
  generatedCount: number;
  skippedOverlapCount: number;
}

function toView(row: ShiftTemplateRow): ShiftTemplateView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    siteId: row.siteId,
    postId: row.postId,
    employeeId: row.employeeId,
    weekdays: [...row.weekdays].sort((a, b) => a - b),
    startTime: row.startTime,
    durationMinutes: row.durationMinutes,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validationError(field: string, message: string) {
  return new ValidationException([{ field, constraints: [message] }]);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

// Manages recurring weekly shift templates (`ShiftTemplate`) and materializes
// upcoming `Shift` rows for the next `SHIFT_HORIZON_DAYS` days in the site tz.
@Injectable()
export class ShiftTemplatesService {
  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly sites: SitesService,
    private readonly posts: PostsService,
    private readonly employees: EmployeesService,
    private readonly events: OrganizationEventsService,
  ) {}

  async create(
    actor: OrganizationActor,
    body: CreateShiftTemplateBodyDto,
  ): Promise<ShiftTemplateWithGeneration> {
    const manager = requireSiteManager(actor);
    const site = await this.sites.getForTenant(manager.tenantId, body.siteId);
    if (!site.isActive) {
      throw validationError('siteId', 'Site is inactive');
    }

    const post = await this.posts.getForTenant(manager.tenantId, body.postId);
    if (post.siteId !== site.id) {
      throw new PostNotFoundException();
    }
    if (!post.isActive) {
      throw validationError('postId', 'Post is inactive');
    }

    const employeeId = body.employeeId ?? null;
    if (employeeId !== null) {
      await this.requireActiveEmployee(manager.tenantId, employeeId);
    }

    const weekdays = [...new Set(body.weekdays)].sort((a, b) => a - b);
    const created = (await this.prisma.shiftTemplate.create({
      data: {
        tenantId: manager.tenantId,
        siteId: site.id,
        postId: post.id,
        employeeId,
        weekdays,
        startTime: body.startTime,
        durationMinutes: body.durationMinutes,
      },
    })) as ShiftTemplateRow;

    const generated = await this.generateForTemplate(
      created,
      site.timezone,
      created.employeeId,
      new Date(),
    );

    return {
      template: toView(created),
      ...generated,
    };
  }

  async update(
    actor: OrganizationActor,
    templateId: string,
    body: UpdateShiftTemplateBodyDto,
  ): Promise<ShiftTemplateWithGeneration> {
    const manager = requireSiteManager(actor);
    const existing = (await this.prisma.shiftTemplate.findFirst({
      where: { id: templateId, tenantId: manager.tenantId },
    })) as ShiftTemplateRow | null;
    if (!existing) {
      throw new ShiftTemplateNotFoundException();
    }

    let employeeActive = existing.employeeId !== null;
    if (body.employeeId !== undefined && body.employeeId !== null) {
      await this.requireActiveEmployee(manager.tenantId, body.employeeId);
      employeeActive = true;
    } else if (existing.employeeId !== null && body.employeeId === undefined) {
      const currentEmployee = await this.employees
        .getForTenant(manager.tenantId, { employeeId: existing.employeeId })
        .catch(() => null);
      employeeActive = Boolean(currentEmployee?.isActive);
    }

    const data: Record<string, unknown> = {};
    if (body.weekdays !== undefined) {
      data.weekdays = [...new Set(body.weekdays)].sort((a, b) => a - b);
    }
    if (body.startTime !== undefined) data.startTime = body.startTime;
    if (body.durationMinutes !== undefined) {
      data.durationMinutes = body.durationMinutes;
    }
    if (body.employeeId !== undefined) data.employeeId = body.employeeId;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    const updated =
      Object.keys(data).length > 0
        ? ((await this.prisma.shiftTemplate.update({
            where: { id: existing.id },
            data,
          })) as ShiftTemplateRow)
        : existing;

    if (!updated.isActive) {
      return { template: toView(updated), generatedCount: 0, skippedOverlapCount: 0 };
    }

    const site = await this.sites.getForTenant(manager.tenantId, updated.siteId);
    const post = await this.posts.getForTenant(manager.tenantId, updated.postId);
    if (!site.isActive || !post.isActive) {
      return { template: toView(updated), generatedCount: 0, skippedOverlapCount: 0 };
    }

    const effectiveEmployeeId =
      updated.employeeId !== null && employeeActive ? updated.employeeId : null;
    const generated = await this.generateForTemplate(
      updated,
      site.timezone,
      effectiveEmployeeId,
      new Date(),
    );

    return {
      template: toView(updated),
      ...generated,
    };
  }

  async deactivate(
    actor: OrganizationActor,
    templateId: string,
  ): Promise<ShiftTemplateView> {
    const manager = requireSiteManager(actor);
    const existing = (await this.prisma.shiftTemplate.findFirst({
      where: { id: templateId, tenantId: manager.tenantId },
    })) as ShiftTemplateRow | null;
    if (!existing) {
      throw new ShiftTemplateNotFoundException();
    }
    if (!existing.isActive) {
      return toView(existing);
    }

    const updated = (await this.prisma.shiftTemplate.update({
      where: { id: existing.id },
      data: { isActive: false },
    })) as ShiftTemplateRow;
    return toView(updated);
  }

  async list(
    actor: OrganizationActor,
    query: ListShiftTemplatesQueryDto,
  ): Promise<PageResult<ShiftTemplateView>> {
    const reader = requireTenantActor(actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filters: Record<string, unknown>[] = [{ tenantId: reader.tenantId }];

    if (reader.role === 'supervisor') {
      filters.push({ siteId: { in: reader.siteIds ?? [] } });
    } else if (reader.role === 'employee') {
      try {
        const own = await this.employees.getForTenant(reader.tenantId, {
          userId: reader.userId,
        });
        filters.push({ employeeId: own.id });
      } catch (error) {
        if (error instanceof EmployeeNotFoundException) {
          return { items: [], total: 0, page, limit };
        }
        throw error;
      }
    }

    if (query.siteId) {
      if (reader.role === 'supervisor' && !canAccessSite(reader, query.siteId)) {
        return { items: [], total: 0, page, limit };
      }
      filters.push({ siteId: query.siteId });
    }
    if (query.postId) filters.push({ postId: query.postId });
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.isActive !== undefined) filters.push({ isActive: query.isActive });

    const where = filters.length === 1 ? filters[0] : { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.shiftTemplate.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }) as Promise<ShiftTemplateRow[]>,
      this.prisma.shiftTemplate.count({ where }),
    ]);

    return { items: rows.map(toView), total, page, limit };
  }

  // Called daily by `ShiftGeneratorJob`. Skips suspended tenants and inactive
  // sites/posts; inactive employees produce unassigned (`null`) future shifts.
  async generateUpcomingForActiveTenants(
    now: Date = new Date(),
  ): Promise<ShiftGenerationSummary> {
    const suspended = await this.prisma.tenantState.findMany({
      where: { isSuspended: true },
      select: { tenantId: true },
    });
    const skipTenants = suspended.map((state) => state.tenantId);

    const summary: ShiftGenerationSummary = {
      templatesProcessed: 0,
      generatedCount: 0,
      skippedOverlapCount: 0,
    };

    let cursorId: string | undefined;
    for (;;) {
      const rows = (await this.prisma.shiftTemplate.findMany({
        where: {
          isActive: true,
          ...(skipTenants.length > 0
            ? { tenantId: { notIn: skipTenants } }
            : {}),
        },
        include: {
          site: { select: { id: true, timezone: true, isActive: true } },
          post: { select: { id: true, isActive: true } },
          employee: { select: { id: true, isActive: true } },
        },
        orderBy: { id: 'asc' },
        take: CRON_BATCH_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      })) as GenerationContextRow[];

      if (rows.length === 0) break;

      for (const row of rows) {
        summary.templatesProcessed++;
        if (!row.site.isActive || !row.post.isActive) continue;
        const effectiveEmployeeId =
          row.employee && row.employee.isActive ? row.employee.id : null;
        const result = await this.generateForTemplate(
          row,
          row.site.timezone,
          effectiveEmployeeId,
          now,
        );
        summary.generatedCount += result.generatedCount;
        summary.skippedOverlapCount += result.skippedOverlapCount;
      }

      if (rows.length < CRON_BATCH_SIZE) break;
      cursorId = rows[rows.length - 1].id;
    }

    return summary;
  }

  private async generateForTemplate(
    template: ShiftTemplateRow,
    timeZone: string,
    employeeId: string | null,
    now: Date,
  ): Promise<{ generatedCount: number; skippedOverlapCount: number }> {
    const horizonDays = envs.shiftHorizonDays ?? DEFAULT_HORIZON_DAYS;
    const today = localCalendarDay(now, timeZone);
    const weekdaySet = new Set(template.weekdays);

    const candidates: { startsAt: Date; endsAt: Date }[] = [];
    for (let offset = 0; offset < horizonDays; offset++) {
      const day = addCalendarDays(today, offset);
      if (!weekdaySet.has(isoWeekday(day))) continue;
      const window = templateShiftWindow(
        day,
        template.startTime,
        template.durationMinutes,
        timeZone,
      );
      if (window.startsAt.getTime() <= now.getTime()) continue;
      candidates.push(window);
    }

    if (candidates.length === 0) {
      return { generatedCount: 0, skippedOverlapCount: 0 };
    }

    const minStart = candidates[0].startsAt;
    const maxEnd = candidates[candidates.length - 1].endsAt;

    const existingRows = (await this.prisma.shift.findMany({
      where: {
        tenantId: template.tenantId,
        templateId: template.id,
        startsAt: { gte: minStart, lte: candidates[candidates.length - 1].startsAt },
      },
      select: { startsAt: true },
    })) as { startsAt: Date }[];
    const existingStarts = new Set(
      existingRows.map((row) => row.startsAt.getTime()),
    );

    const busyWindows =
      employeeId !== null
        ? ((await this.prisma.shift.findMany({
            where: {
              tenantId: template.tenantId,
              employeeId,
              status: { not: 'CANCELLED' },
              startsAt: { lt: maxEnd },
              endsAt: { gt: minStart },
            },
            select: { startsAt: true, endsAt: true },
          })) as { startsAt: Date; endsAt: Date }[])
        : [];

    let generatedCount = 0;
    let skippedOverlapCount = 0;

    for (const candidate of candidates) {
      const startMs = candidate.startsAt.getTime();
      const endMs = candidate.endsAt.getTime();
      if (existingStarts.has(startMs)) continue;

      const overlaps =
        employeeId !== null &&
        busyWindows.some(
          (slot) =>
            slot.startsAt.getTime() < endMs && slot.endsAt.getTime() > startMs,
        );
      if (overlaps) {
        skippedOverlapCount++;
        continue;
      }

      try {
        const created = (await this.prisma.shift.create({
          data: {
            tenantId: template.tenantId,
            templateId: template.id,
            siteId: template.siteId,
            postId: template.postId,
            employeeId,
            startsAt: candidate.startsAt,
            endsAt: candidate.endsAt,
          },
        })) as {
          id: string;
          tenantId: string;
          siteId: string;
          postId: string;
          employeeId: string | null;
          startsAt: Date;
          endsAt: Date;
          status: string;
          version: number;
        };

        generatedCount++;
        existingStarts.add(startMs);
        if (employeeId !== null) {
          busyWindows.push(candidate);
        }

        await this.events.publish(created.tenantId, ORGANIZATION_EVENTS.shiftCreated, {
          shiftId: created.id,
          tenantId: created.tenantId,
          siteId: created.siteId,
          postId: created.postId,
          employeeId: created.employeeId,
          startsAt: created.startsAt.toISOString(),
          endsAt: created.endsAt.toISOString(),
          status: created.status,
          version: created.version,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }

    return { generatedCount, skippedOverlapCount };
  }

  private async requireActiveEmployee(
    tenantId: string,
    employeeId: string,
  ): Promise<void> {
    const employee = await this.employees.getForTenant(tenantId, { employeeId });
    if (!employee.isActive) {
      throw validationError('employeeId', 'Employee is inactive');
    }
  }
}
