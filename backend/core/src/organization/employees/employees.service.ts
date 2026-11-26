import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AuthService } from '../../auth/auth.service';
import {
  EmailTakenException,
  EmployeeNotFoundException,
  ForbiddenException,
  TenantCancelledException,
  TenantSuspendedException,
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
  BulkImportEmployeesBodyDto,
  CreateEmployeeBodyDto,
  ListEmployeesQueryDto,
  UpdateEmployeeBodyDto,
} from './dto/employee.dto';
import { canSeeNationalId, requireEmployeeManager } from './employee-policy';

const UNIQUE_VIOLATION = 'P2002';
export const EMPLOYEE_AUTH_PROVISIONER = 'EMPLOYEE_AUTH_PROVISIONER';

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

export interface BulkImportEmployeeRowResult {
  rowNumber: number;
  nationalId: string;
  fullName: string;
  email: string;
  status: 'created' | 'updated' | 'failed';
  employeeId?: string;
  code?: string;
  detail?: string;
}

export interface BulkImportEmployeesResult {
  siteId: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  results: BulkImportEmployeeRowResult[];
}

export function splitEmployeeFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const trimmed = fullName.trim();
  if (trimmed.includes(',')) {
    const [rawLast, ...rawFirstParts] = trimmed.split(',');
    const first = rawFirstParts.join(' ').trim();
    const last = rawLast.trim();
    if (first && last) {
      return {
        firstName: first.slice(0, 100),
        lastName: last.slice(0, 100),
      };
    }
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return {
      firstName: words[0].slice(0, 100),
      lastName: words.slice(1).join(' ').slice(0, 100),
    };
  }
  const single = words[0] ?? '';
  const camelMatch =
    /^([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+)((?:[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]*)+)$/.exec(
      single,
    );
  if (camelMatch) {
    const tailWords = camelMatch[2]
      .replace(/([a-z0-9áéíóúüñ])([A-ZÁÉÍÓÚÜÑ])/g, '$1 $2')
      .trim();
    return {
      firstName: camelMatch[1].slice(0, 100),
      lastName: tailWords.slice(0, 100),
    };
  }
  return {
    firstName: (single || '-').slice(0, 100),
    lastName: '-',
  };
}

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
    @Optional()
    @Inject(EMPLOYEE_AUTH_PROVISIONER)
    private readonly auth?: Pick<AuthService, 'provisionEmployeeAccount'>,
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

  // `organization.employee.bulk-import` (owner/admin). Provisions an active
  // `EMPLOYEE` login account in `auth` (Argon2id password hash) and creates or
  // links the employee profile enabled for `siteId`. Per-row conflicts (email
  // taken in another tenant, DNI conflict) are reported in `results` without
  // aborting valid rows.
  async bulkImportForSite(
    actor: OrganizationActor,
    siteId: string,
    dto: BulkImportEmployeesBodyDto,
  ): Promise<BulkImportEmployeesResult> {
    const manager = requireEmployeeManager(actor);
    await this.requireTenantSites(manager.tenantId, [siteId]);
    if (!this.auth) {
      throw new Error('AuthService is not available');
    }

    const results: BulkImportEmployeeRowResult[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    for (let index = 0; index < dto.items.length; index++) {
      const item = dto.items[index];
      const rowNumber = index + 1;
      const email = normalizeEmail(item.email);
      const nationalId = item.nationalId.trim();
      const fullName = item.fullName.trim();
      const { firstName, lastName } = splitEmployeeFullName(fullName);
      const displayName =
        lastName === '-' ? firstName : `${firstName} ${lastName}`;

      const dniMatches = await this.prisma.employee.findMany({
        where: { tenantId: manager.tenantId, nationalId },
        include: { sites: { select: { siteId: true } } },
        skip: 0,
        take: 5,
      });
      if (dniMatches.some((existing) => existing.email !== email)) {
        failedCount++;
        results.push({
          rowNumber,
          nationalId,
          fullName,
          email,
          status: 'failed',
          code: 'national_id_taken',
          detail:
            'Ya existe otro trabajador en la organización con ese DNI y otro correo.',
        });
        continue;
      }

      let provisioned: { userId: string; email: string; created: boolean };
      try {
        provisioned = await this.auth.provisionEmployeeAccount({
          actor: {
            userId: manager.userId,
            tenantId: manager.tenantId,
            role: manager.role,
          },
          email,
          name: displayName,
          password: item.password,
        });
      } catch (error) {
        if (
          error instanceof ForbiddenException ||
          error instanceof TenantSuspendedException ||
          error instanceof TenantCancelledException
        ) {
          throw error;
        }
        if (error instanceof EmailTakenException) {
          failedCount++;
          results.push({
            rowNumber,
            nationalId,
            fullName,
            email,
            status: 'failed',
            code: 'email_taken',
            detail:
              'El correo electrónico ya está registrado en otra organización.',
          });
          continue;
        }
        throw error;
      }

      const existingEmployee = await this.prisma.employee.findFirst({
        where: { tenantId: manager.tenantId, email },
        include: { sites: { select: { siteId: true } } },
      });

      if (!existingEmployee) {
        try {
          const row = await this.prisma.employee.create({
            data: {
              tenantId: manager.tenantId,
              userId: provisioned.userId,
              email,
              firstName,
              lastName,
              nationalId,
              skills: [],
              isActive: true,
              sites: {
                create: [{ tenantId: manager.tenantId, siteId }],
              },
            },
            include: { sites: { select: { siteId: true } } },
          });

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
          await this.events.publish(
            row.tenantId,
            ORGANIZATION_EVENTS.employeeUpdated,
            {
              employeeId: row.id,
              tenantId: row.tenantId,
              userId: row.userId,
              firstName: row.firstName,
              lastName: row.lastName,
              employeeNumber: row.employeeNumber,
              isActive: row.isActive,
              siteIds: row.sites.map((site) => site.siteId),
            },
          );

          createdCount++;
          results.push({
            rowNumber,
            nationalId,
            fullName,
            email,
            status: 'created',
            employeeId: row.id,
          });
          continue;
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }
          // Concurrent creation (e.g. `UserCreatedHandler` consumer): fall through
          // to the idempotent update + site link path below.
        }
      }

      const target =
        existingEmployee ?? (await this.findOrThrow(manager.tenantId, { email }));
      const wasAutoStub = provisioned.created && target.nationalId === null;
      const alreadyInSite = target.sites.some((site) => site.siteId === siteId);

      await this.prisma.$transaction(async (tx) => {
        await tx.employee.updateMany({
          where: { id: target.id, tenantId: manager.tenantId },
          data: {
            firstName,
            lastName,
            nationalId,
            isActive: true,
            ...(target.userId === null ? { userId: provisioned.userId } : {}),
          },
        });
        if (!alreadyInSite) {
          await tx.employeeSite.createMany({
            data: [
              {
                tenantId: manager.tenantId,
                employeeId: target.id,
                siteId,
              },
            ],
          });
        }
      });

      const updatedRow = await this.findOrThrow(manager.tenantId, {
        id: target.id,
      });
      await this.events.publish(
        updatedRow.tenantId,
        ORGANIZATION_EVENTS.employeeUpdated,
        {
          employeeId: updatedRow.id,
          tenantId: updatedRow.tenantId,
          userId: updatedRow.userId,
          firstName: updatedRow.firstName,
          lastName: updatedRow.lastName,
          employeeNumber: updatedRow.employeeNumber,
          isActive: updatedRow.isActive,
          siteIds: updatedRow.sites.map((site) => site.siteId),
        },
      );

      if (wasAutoStub) {
        createdCount++;
        results.push({
          rowNumber,
          nationalId,
          fullName,
          email,
          status: 'created',
          employeeId: updatedRow.id,
        });
      } else {
        updatedCount++;
        results.push({
          rowNumber,
          nationalId,
          fullName,
          email,
          status: 'updated',
          employeeId: updatedRow.id,
        });
      }
    }

    return {
      siteId,
      totalRows: dto.items.length,
      createdCount,
      updatedCount,
      failedCount,
      results,
    };
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
    await this.events.publish(
      row.tenantId,
      ORGANIZATION_EVENTS.employeeUpdated,
      {
        employeeId: row.id,
        tenantId: row.tenantId,
        userId: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        employeeNumber: row.employeeNumber,
        isActive: row.isActive,
        siteIds: row.sites.map((site) => site.siteId),
      },
    );
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

  // For the telemetry NATS catalog responder: all employees of `tenantId`.
  async listForTenant(tenantId: string): Promise<EmployeeView[]> {
    const rows = await this.prisma.employee.findMany({
      where: { tenantId },
      include: { sites: { select: { siteId: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toView(null, row));
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
      const searchFields: Record<string, unknown>[] = [
        { firstName: contains },
        { lastName: contains },
        { email: contains },
      ];
      if (reader.role === 'owner' || reader.role === 'admin') {
        searchFields.push({ nationalId: contains }, { employeeNumber: contains });
      }
      filters.push({ OR: searchFields });
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
