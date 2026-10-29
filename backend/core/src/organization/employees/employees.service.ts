import { Injectable } from '@nestjs/common';
import {
  EmailTakenException,
  EmployeeNotFoundException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import { normalizeEmail } from '../../common/email';
import { OrganizationEventsService } from '../events/organization-events.service';
import type { OrganizationActor } from '../organization-actor';
import { ORGANIZATION_EVENTS } from '../organization.patterns';
import { OrganizationPrismaService } from '../prisma/prisma.service';
import { requireTenantActor, type TenantActor } from '../sites/site-policy';
import {
  pageWindow,
  SitesService,
  type PageResult,
} from '../sites/sites.service';
import type {
  CreateEmployeeBodyDto,
  ListEmployeesQueryDto,
  UpdateEmployeeBodyDto,
} from './dto/employee.dto';
import { canSeeNationalId, requireEmployeeManager } from './employee-policy';

const UNIQUE_VIOLATION = 'P2002';

interface EmployeeRow {
  id: string;
  tenantId: string;
  userId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarMediaId: string | null;
  employeeNumber: string | null;
  nationalId: string | null;
  skills: string[];
  weeklyHoursLimit: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  sites: { siteId: string }[];
}

// `nationalId` is absent when the actor may not see it; `siteIds` are the
// enabled sites.
export type EmployeeView = Omit<EmployeeRow, 'sites' | 'nationalId'> & {
  nationalId?: string | null;
  siteIds: string[];
};

export type EmployeeLookup = { employeeId: string } | { userId: string };

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

function definedFields(dto: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(dto).filter(([, value]) => value !== undefined),
  );
}

function lookupWhere(lookup: EmployeeLookup): Record<string, unknown> {
  return 'employeeId' in lookup
    ? { id: lookup.employeeId }
    : { userId: lookup.userId };
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly events: OrganizationEventsService,
    private readonly sites: SitesService,
  ) {}

  // `organization.employee.create` (owner/admin). Email and legajo are unique
  // per tenant (409 `email_taken`). Emits `employee_created` after the commit.
  async create(
    actor: OrganizationActor,
    dto: CreateEmployeeBodyDto,
  ): Promise<EmployeeView> {
    const manager = requireEmployeeManager(actor);
    const siteIds = dto.siteIds ?? [];
    await this.requireTenantSites(manager.tenantId, siteIds);

    let row: EmployeeRow;
    try {
      row = await this.prisma.employee.create({
        data: {
          tenantId: manager.tenantId,
          email: normalizeEmail(dto.email),
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone ?? null,
          avatarMediaId: dto.avatarMediaId ?? null,
          employeeNumber: dto.employeeNumber ?? null,
          nationalId: dto.nationalId ?? null,
          skills: dto.skills ?? [],
          weeklyHoursLimit: dto.weeklyHoursLimit ?? null,
          sites: {
            create: siteIds.map((siteId) => ({
              tenantId: manager.tenantId,
              siteId,
            })),
          },
        },
        include: { sites: { select: { siteId: true } } },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new EmailTakenException();
      throw error;
    }

    await this.events.publish(
      row.tenantId,
      ORGANIZATION_EVENTS.employeeCreated,
      {
        employeeId: row.id,
        tenantId: row.tenantId,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
      },
    );
    return this.toView(manager, row);
  }

  // `organization.employee.update` (owner/admin). Employees are never deleted:
  // `isActive: false` deactivates. `siteIds` replaces the enabled set.
  async update(
    actor: OrganizationActor,
    employeeId: string,
    dto: UpdateEmployeeBodyDto,
  ): Promise<EmployeeView> {
    const manager = requireEmployeeManager(actor);
    await this.findOrThrow(manager.tenantId, { id: employeeId });
    const { siteIds, ...fields } = dto;
    if (siteIds) {
      await this.requireTenantSites(manager.tenantId, siteIds);
    }
    const data = definedFields(fields);

    try {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.employee.updateMany({
          where: { id: employeeId, tenantId: manager.tenantId },
          data,
        });
        if (count !== 1) throw new EmployeeNotFoundException();
        if (siteIds) {
          await tx.employeeSite.deleteMany({
            where: { employeeId, tenantId: manager.tenantId },
          });
          await tx.employeeSite.createMany({
            data: siteIds.map((siteId) => ({
              tenantId: manager.tenantId,
              employeeId,
              siteId,
            })),
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new EmailTakenException();
      throw error;
    }

    const row = await this.findOrThrow(manager.tenantId, { id: employeeId });
    return this.toView(manager, row);
  }

  // `organization.employee.get`. Out of the actor's visibility: 404.
  async get(
    actor: OrganizationActor,
    lookup: EmployeeLookup,
  ): Promise<EmployeeView> {
    const reader = requireTenantActor(actor);
    const row = await this.findOrThrow(reader.tenantId, {
      AND: [lookupWhere(lookup), this.visibility(reader)],
    });
    return this.toView(reader, row);
  }

  // Background-style lookup with an explicit tenant, for the NATS responder
  // `telemetry` calls (T5). There is no actor: only trusted code calls it.
  async getForTenant(
    tenantId: string,
    lookup: EmployeeLookup,
  ): Promise<EmployeeView> {
    const row = await this.findOrThrow(tenantId, lookupWhere(lookup));
    return this.toView(null, row);
  }

  // `organization.employee.list`. Owner/admin: the tenant; supervisor: only
  // employees enabled in one of their sites; employee: only themselves.
  async list(
    actor: OrganizationActor,
    query: ListEmployeesQueryDto,
  ): Promise<PageResult<EmployeeView>> {
    const reader = requireTenantActor(actor);
    const filters: Record<string, unknown>[] = [this.visibility(reader)];
    if (query.siteId) {
      filters.push({ sites: { some: { siteId: query.siteId } } });
    }
    if (query.isActive !== undefined) {
      filters.push({ isActive: query.isActive });
    }
    if (query.search) {
      const contains = { contains: query.search, mode: 'insensitive' };
      filters.push({
        OR: [
          { firstName: contains },
          { lastName: contains },
          { email: contains },
        ],
      });
    }
    const where = { tenantId: reader.tenantId, AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: { sites: { select: { siteId: true } } },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.employee.count({ where }),
    ]);
    return { items: rows.map((row) => this.toView(reader, row)), total };
  }

  private visibility(actor: TenantActor): Record<string, unknown> {
    if (actor.role === 'supervisor') {
      return { sites: { some: { siteId: { in: actor.siteIds ?? [] } } } };
    }
    if (actor.role === 'employee') {
      return { userId: actor.userId };
    }
    return {};
  }

  private async requireTenantSites(tenantId: string, siteIds: string[]) {
    if (siteIds.length === 0) return;
    const existing = new Set(
      await this.sites.findExistingSiteIds(tenantId, siteIds),
    );
    if (siteIds.some((siteId) => !existing.has(siteId))) {
      throw new ValidationException([
        {
          field: 'siteIds',
          constraints: ['siteIds must be sites of this organization'],
        },
      ]);
    }
  }

  private async findOrThrow(
    tenantId: string,
    where: Record<string, unknown>,
  ): Promise<EmployeeRow> {
    const row = await this.prisma.employee.findFirst({
      where: { ...where, tenantId },
      include: { sites: { select: { siteId: true } } },
    });
    if (!row) throw new EmployeeNotFoundException();
    return row;
  }

  // `actor` null = trusted internal read, which sees every field.
  private toView(actor: TenantActor | null, row: EmployeeRow): EmployeeView {
    const { sites, nationalId, ...rest } = row;
    const view: EmployeeView = {
      ...rest,
      siteIds: sites.map((site) => site.siteId),
    };
    if (!actor || canSeeNationalId(actor, row.userId)) {
      view.nationalId = nationalId;
    }
    return view;
  }
}
