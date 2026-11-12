import { Injectable } from '@nestjs/common';
import {
  PostNotFoundException,
  ShiftNotEditableException,
  ShiftNotFoundException,
  ShiftOverlapException,
  SiteNotFoundException,
  ValidationException,
  VersionConflictException,
} from '../../common/exceptions/app.exceptions';
import { EmployeesService } from '../employees/employees.service';
import type { EmployeeView } from '../employees/employees.service';
import { OrganizationEventsService } from '../events/organization-events.service';
import type { OrganizationActor } from '../organization-actor';
import { ORGANIZATION_EVENTS } from '../organization.patterns';
import { OrganizationPrismaService } from '../prisma/prisma.service';
import { requireTenantActor } from '../sites/site-policy';
import type { TenantActor } from '../sites/site-policy';
import { PostsService } from '../sites/posts.service';
import { pageWindow, SitesService } from '../sites/sites.service';
import type { PageResult } from '../sites/sites.service';
import type {
  CreateShiftBodyDto,
  ListShiftsQueryDto,
  UpdateShiftBodyDto,
} from './dto/shift.dto';
import { canManageSite, requireShiftManager } from './shift-policy';
import { dayRange, isCalendarDay, weekRange } from './shift-time';

type ShiftStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

interface ShiftRow {
  id: string;
  tenantId: string;
  templateId: string | null;
  siteId: string;
  postId: string;
  employeeId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: ShiftStatus;
  version: number;
  startingEmittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// The lifecycle marker is internal to the job.
export type ShiftView = Omit<ShiftRow, 'startingEmittedAt'>;

export type ShiftWarningCode =
  | 'rest_under_12h'
  | 'weekly_hours_exceeded'
  | 'missing_skill'
  | 'site_not_enabled';

export interface ShiftWarning {
  code: ShiftWarningCode;
  message: string;
}

export interface ShiftWithWarnings {
  shift: ShiftView;
  warnings: ShiftWarning[];
}

type ShiftEvent =
  | typeof ORGANIZATION_EVENTS.shiftCreated
  | typeof ORGANIZATION_EVENTS.shiftUpdated
  | typeof ORGANIZATION_EVENTS.shiftCancelled;

type TxClient = Parameters<
  Parameters<OrganizationPrismaService['$transaction']>[0]
>[0];

const REST_HOURS = 12;
const HOUR_MS = 60 * 60 * 1000;

function toView(row: ShiftRow): ShiftView {
  const { startingEmittedAt: _internal, ...view } = row;
  return view;
}

function validationError(field: string, message: string) {
  return new ValidationException([{ field, constraints: [message] }]);
}

function parseInstant(field: string, value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw validationError(field, `${field} must be a valid instant`);
  }
  return date;
}

function requireValidRange(startsAt: Date, endsAt: Date) {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw validationError('endsAt', 'endsAt must be after startsAt');
  }
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly events: OrganizationEventsService,
    private readonly sites: SitesService,
    private readonly posts: PostsService,
    private readonly employees: EmployeesService,
  ) {}

  // `organization.shift.create` (owner/admin, supervisor inside `siteIds`).
  // The overlap check runs in the write's transaction under a per-employee
  // lock. Emits `shift_created` after the commit.
  async create(
    actor: OrganizationActor,
    dto: CreateShiftBodyDto,
  ): Promise<ShiftWithWarnings> {
    const manager = requireShiftManager(actor);
    const startsAt = parseInstant('startsAt', dto.startsAt);
    const endsAt = parseInstant('endsAt', dto.endsAt);
    requireValidRange(startsAt, endsAt);

    // A supervisor outside the site learns nothing: same 404 as a missing site.
    if (!canManageSite(manager, dto.siteId)) {
      throw new SiteNotFoundException();
    }
    const site = await this.sites.getForTenant(manager.tenantId, dto.siteId);
    const post = await this.requireSitePost(
      manager.tenantId,
      site.id,
      dto.postId,
    );
    const employee = dto.employeeId
      ? await this.requireAssignable(manager.tenantId, dto.employeeId)
      : null;

    const warnings = employee
      ? await this.warningsFor({
          tenantId: manager.tenantId,
          employee,
          siteId: site.id,
          timezone: site.timezone,
          requiredSkills: post.requiredSkills,
          startsAt,
          endsAt,
          excludeShiftId: null,
        })
      : [];

    const row = await this.prisma.$transaction(async (tx) => {
      if (employee) {
        await this.lockEmployee(tx, manager.tenantId, employee.id);
        await this.assertNoOverlap(tx, {
          tenantId: manager.tenantId,
          employeeId: employee.id,
          startsAt,
          endsAt,
          excludeShiftId: null,
        });
      }
      return tx.shift.create({
        data: {
          tenantId: manager.tenantId,
          siteId: site.id,
          postId: post.id,
          employeeId: employee?.id ?? null,
          startsAt,
          endsAt,
        },
      });
    });

    await this.emit(ORGANIZATION_EVENTS.shiftCreated, row);
    return { shift: toView(row), warnings };
  }

  // `organization.shift.update`: times and post. Optimistic locking on
  // `version`; a cancelled or finished shift is not editable.
  async update(
    actor: OrganizationActor,
    shiftId: string,
    dto: UpdateShiftBodyDto,
  ): Promise<ShiftWithWarnings> {
    const manager = requireShiftManager(actor);
    const current = await this.findManageable(manager, shiftId);
    this.assertEditable(current, dto.version);

    const startsAt = dto.startsAt
      ? parseInstant('startsAt', dto.startsAt)
      : current.startsAt;
    const endsAt = dto.endsAt
      ? parseInstant('endsAt', dto.endsAt)
      : current.endsAt;
    requireValidRange(startsAt, endsAt);
    const postId = dto.postId ?? current.postId;
    const post = await this.requireSitePost(
      manager.tenantId,
      current.siteId,
      postId,
    );

    return this.writeChange(manager, current, {
      startsAt,
      endsAt,
      postId,
      employeeId: current.employeeId,
      requiredSkills: post.requiredSkills,
    });
  }

  // `organization.shift.reassign`: another employee, or `null` to unassign.
  async reassign(
    actor: OrganizationActor,
    shiftId: string,
    dto: { version: number; employeeId: string | null },
  ): Promise<ShiftWithWarnings> {
    const manager = requireShiftManager(actor);
    const current = await this.findManageable(manager, shiftId);
    this.assertEditable(current, dto.version);
    if (dto.employeeId) {
      await this.requireAssignable(manager.tenantId, dto.employeeId);
    }
    const post = await this.posts.getForTenant(
      manager.tenantId,
      current.postId,
    );

    return this.writeChange(manager, current, {
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      postId: current.postId,
      employeeId: dto.employeeId,
      requiredSkills: post.requiredSkills,
    });
  }

  // `organization.shift.cancel`. Emits `shift_cancelled`.
  async cancel(
    actor: OrganizationActor,
    shiftId: string,
    dto: { version: number },
  ): Promise<ShiftView> {
    const manager = requireShiftManager(actor);
    const current = await this.findManageable(manager, shiftId);
    this.assertEditable(current, dto.version);

    const row = await this.prisma.$transaction(async (tx) => {
      await this.updateWithVersion(tx, current, { status: 'CANCELLED' });
      return tx.shift.findFirstOrThrow({
        where: { id: current.id, tenantId: manager.tenantId },
      });
    });
    await this.emit(ORGANIZATION_EVENTS.shiftCancelled, row);
    return toView(row);
  }

  // `organization.shift.get`. Owner/admin: the tenant; supervisor: only
  // `siteIds`; employee: only their own shifts. Anything else: 404.
  async get(actor: OrganizationActor, shiftId: string): Promise<ShiftView> {
    const reader = requireTenantActor(actor);
    const row = await this.prisma.shift.findFirst({
      where: {
        id: shiftId,
        tenantId: reader.tenantId,
        ...this.visibility(reader),
      },
    });
    if (!row) throw new ShiftNotFoundException();
    return toView(row);
  }

  // Background-style lookup with an explicit tenant, for the NATS responder
  // `telemetry` calls (T5). There is no actor: only trusted code calls it.
  async getForTenant(tenantId: string, shiftId: string): Promise<ShiftView> {
    const row = await this.prisma.shift.findFirst({
      where: { id: shiftId, tenantId },
    });
    if (!row) throw new ShiftNotFoundException();
    return toView(row);
  }

  // `organization.shift.list`, ordered by start. `day` is a wall-clock date in
  // the timezone of `siteId`.
  async list(
    actor: OrganizationActor,
    query: ListShiftsQueryDto,
  ): Promise<PageResult<ShiftView>> {
    const reader = requireTenantActor(actor);
    const filters: Record<string, unknown>[] = [this.visibility(reader)];
    if (query.siteId) filters.push({ siteId: query.siteId });
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.day) {
      if (!query.siteId) {
        throw validationError('siteId', 'siteId is required to filter by day');
      }
      if (!isCalendarDay(query.day)) {
        throw validationError('day', 'day must be a valid YYYY-MM-DD date');
      }
      // An unknown site of this tenant has no shifts; the visibility filter
      // already empties the result for an out-of-scope site.
      let timezone: string;
      try {
        timezone = (
          await this.sites.getForTenant(reader.tenantId, query.siteId)
        ).timezone;
      } catch (error) {
        if (error instanceof SiteNotFoundException) {
          return { items: [], total: 0 };
        }
        throw error;
      }
      const range = dayRange(query.day, timezone);
      filters.push({ startsAt: { gte: range.start, lt: range.end } });
    }
    const where = { tenantId: reader.tenantId, AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.shift.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.shift.count({ where }),
    ]);
    return { items: rows.map(toView), total };
  }

  // Shared by update and reassign: computes the warnings, writes under the
  // overlap check and the version check, and emits `shift_updated`.
  private async writeChange(
    manager: TenantActor,
    current: ShiftRow,
    change: {
      startsAt: Date;
      endsAt: Date;
      postId: string;
      employeeId: string | null;
      requiredSkills: string[];
    },
  ): Promise<ShiftWithWarnings> {
    const employee = change.employeeId
      ? await this.employees.getForTenant(manager.tenantId, {
          employeeId: change.employeeId,
        })
      : null;
    let warnings: ShiftWarning[] = [];
    if (employee) {
      const site = await this.sites.getForTenant(
        manager.tenantId,
        current.siteId,
      );
      warnings = await this.warningsFor({
        tenantId: manager.tenantId,
        employee,
        siteId: site.id,
        timezone: site.timezone,
        requiredSkills: change.requiredSkills,
        startsAt: change.startsAt,
        endsAt: change.endsAt,
        excludeShiftId: current.id,
      });
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (employee) {
        await this.lockEmployee(tx, manager.tenantId, employee.id);
        await this.assertNoOverlap(tx, {
          tenantId: manager.tenantId,
          employeeId: employee.id,
          startsAt: change.startsAt,
          endsAt: change.endsAt,
          excludeShiftId: current.id,
        });
      }
      await this.updateWithVersion(tx, current, {
        startsAt: change.startsAt,
        endsAt: change.endsAt,
        postId: change.postId,
        employeeId: change.employeeId,
      });
      return tx.shift.findFirstOrThrow({
        where: { id: current.id, tenantId: manager.tenantId },
      });
    });

    await this.emit(ORGANIZATION_EVENTS.shiftUpdated, row);
    return { shift: toView(row), warnings };
  }

  // Compare-and-set on `version`: zero rows means someone else wrote first.
  private async updateWithVersion(
    tx: TxClient,
    current: ShiftRow,
    data: Record<string, unknown>,
  ) {
    const { count } = await tx.shift.updateMany({
      where: {
        id: current.id,
        tenantId: current.tenantId,
        version: current.version,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (count !== 1) throw new VersionConflictException();
  }

  // Serializes concurrent writes for one employee until the transaction ends,
  // so two requests cannot both pass the overlap check. The subselect keeps
  // the void result of the lock function out of Prisma's row decoding.
  private async lockEmployee(
    tx: TxClient,
    tenantId: string,
    employeeId: string,
  ) {
    const key = `shift:${tenantId}:${employeeId}`;
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS employee_lock`;
  }

  private async assertNoOverlap(
    tx: TxClient,
    range: {
      tenantId: string;
      employeeId: string;
      startsAt: Date;
      endsAt: Date;
      excludeShiftId: string | null;
    },
  ) {
    const clash = await tx.shift.findFirst({
      where: {
        tenantId: range.tenantId,
        employeeId: range.employeeId,
        status: { not: 'CANCELLED' as const },
        ...(range.excludeShiftId ? { id: { not: range.excludeShiftId } } : {}),
        startsAt: { lt: range.endsAt },
        endsAt: { gt: range.startsAt },
      },
      select: { id: true },
    });
    if (clash) throw new ShiftOverlapException();
  }

  // The four non-blocking rules. Messages carry no personal data.
  private async warningsFor(input: {
    tenantId: string;
    employee: EmployeeView;
    siteId: string;
    timezone: string;
    requiredSkills: string[];
    startsAt: Date;
    endsAt: Date;
    excludeShiftId: string | null;
  }): Promise<ShiftWarning[]> {
    const warnings: ShiftWarning[] = [];
    const { employee } = input;
    const others = {
      tenantId: input.tenantId,
      employeeId: employee.id,
      status: { not: 'CANCELLED' as const },
      ...(input.excludeShiftId ? { id: { not: input.excludeShiftId } } : {}),
    };

    const restWindow = REST_HOURS * HOUR_MS;
    const tooClose = await this.prisma.shift.findFirst({
      where: {
        ...others,
        OR: [
          {
            endsAt: {
              gt: new Date(input.startsAt.getTime() - restWindow),
              lte: input.startsAt,
            },
          },
          {
            startsAt: {
              gte: input.endsAt,
              lt: new Date(input.endsAt.getTime() + restWindow),
            },
          },
        ],
      },
      select: { id: true },
    });
    if (tooClose) {
      warnings.push({
        code: 'rest_under_12h',
        message: 'Less than 12 hours of rest around another shift',
      });
    }

    if (employee.weeklyHoursLimit !== null) {
      const week = weekRange(input.startsAt, input.timezone);
      const sameWeek = await this.prisma.shift.findMany({
        where: { ...others, startsAt: { gte: week.start, lt: week.end } },
        select: { startsAt: true, endsAt: true },
      });
      const totalMs = [
        ...sameWeek,
        { startsAt: input.startsAt, endsAt: input.endsAt },
      ].reduce(
        (sum, item) => sum + (item.endsAt.getTime() - item.startsAt.getTime()),
        0,
      );
      const hours = totalMs / HOUR_MS;
      if (hours > employee.weeklyHoursLimit) {
        warnings.push({
          code: 'weekly_hours_exceeded',
          message: `Weekly hours would be ${Number(hours.toFixed(2))}, over the limit of ${employee.weeklyHoursLimit}`,
        });
      }
    }

    const skills = new Set(employee.skills.map((skill) => skill.toLowerCase()));
    if (
      input.requiredSkills.some((skill) => !skills.has(skill.toLowerCase()))
    ) {
      warnings.push({
        code: 'missing_skill',
        message: 'The employee lacks a skill required by the post',
      });
    }

    if (!employee.siteIds.includes(input.siteId)) {
      warnings.push({
        code: 'site_not_enabled',
        message: 'The site is not enabled for the employee',
      });
    }
    return warnings;
  }

  // Tenant-scoped lookup that also applies the supervisor's site scope: a
  // missing, foreign or out-of-scope shift is the same 404.
  private async findManageable(
    manager: TenantActor,
    shiftId: string,
  ): Promise<ShiftRow> {
    const row = await this.prisma.shift.findFirst({
      where: { id: shiftId, tenantId: manager.tenantId },
    });
    if (!row || !canManageSite(manager, row.siteId)) {
      throw new ShiftNotFoundException();
    }
    return row;
  }

  private assertEditable(row: ShiftRow, version: number) {
    if (row.status === 'CANCELLED' || row.status === 'FINISHED') {
      throw new ShiftNotEditableException();
    }
    if (row.version !== version) throw new VersionConflictException();
  }

  private async requireSitePost(
    tenantId: string,
    siteId: string,
    postId: string,
  ) {
    const post = await this.posts.getForTenant(tenantId, postId);
    if (post.siteId !== siteId) throw new PostNotFoundException();
    return post;
  }

  // Shifts go to existing (404 `employee_not_found`) and active (422)
  // employees of the tenant.
  private async requireAssignable(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeView> {
    const employee = await this.employees.getForTenant(tenantId, {
      employeeId,
    });
    if (!employee.isActive) {
      throw validationError(
        'employeeId',
        'employeeId must be an active employee',
      );
    }
    return employee;
  }

  private visibility(actor: TenantActor): Record<string, unknown> {
    if (actor.role === 'supervisor') {
      return { siteId: { in: actor.siteIds ?? [] } };
    }
    if (actor.role === 'employee') {
      return { employee: { userId: actor.userId } };
    }
    return {};
  }

  // Full snapshot (AGENTS § Events emitted); consumers keep a local copy.
  private emit(event: ShiftEvent, row: ShiftRow) {
    return this.events.publish(row.tenantId, event, {
      shiftId: row.id,
      tenantId: row.tenantId,
      siteId: row.siteId,
      postId: row.postId,
      employeeId: row.employeeId,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      status: row.status,
      version: row.version,
    });
  }
}
