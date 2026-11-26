import { Injectable } from '@nestjs/common';
import {
  EmployeeNotFoundException,
  ForbiddenException,
} from '../common/exceptions';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { OrgSnapshotsService } from '../snapshots/org-snapshots.service';
import type { UpsertReportRecipientDto } from './dto/reports.dto';

export type ReportKind = 'daily' | 'monthly' | 'payroll_excel';

export interface ReportRecipientView {
  id: string;
  tenantId: string;
  userId: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeNumber: string | null;
  siteIds: string[];
  isActiveEmployee: boolean;
  receiveDaily: boolean;
  receiveMonthly: boolean;
  receivePayrollExcel: boolean;
  assignedByUserId: string;
  updatedAt: string;
}

export interface SiteReportEmailPermissions {
  canAccessPanel: boolean;
  canRequestDaily: boolean;
  canRequestMonthly: boolean;
  canRequestPayrollExcel: boolean;
}

@Injectable()
export class ReportRecipientsService {
  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly snapshots: OrgSnapshotsService,
  ) {}

  /**
   * Enforces that only the tenant `owner` or a worker explicitly assigned by
   * the `owner` for `kind` (and still active in `EmployeeSnapshot`) may access
   * or download the report.
   */
  async authorizeReportAccess(
    actor: VerifiedActor,
    kind: ReportKind,
  ): Promise<void> {
    if (actor.role === 'platform_admin' || !actor.tenantId) {
      throw new ForbiddenException();
    }
    if (actor.role === 'owner') {
      return;
    }

    const recipient = await this.prisma.reportRecipient.findUnique({
      where: {
        tenantId_userId: {
          tenantId: actor.tenantId,
          userId: actor.userId,
        },
      },
    });

    if (!recipient) {
      if (actor.role === 'admin') {
        const adminEmp = await this.prisma.employeeSnapshot.findFirst({
          where: { tenantId: actor.tenantId, userId: actor.userId },
        });
        if (adminEmp && adminEmp.isActive && (adminEmp.siteIds?.length ?? 0) > 0) {
          return;
        }
      }
      throw new ForbiddenException(
        'Only the organization owner or assigned report recipients can access this report',
      );
    }

    const allowed =
      kind === 'daily'
        ? recipient.receiveDaily
        : kind === 'monthly'
          ? recipient.receiveMonthly
          : recipient.receivePayrollExcel;

    if (!allowed) {
      throw new ForbiddenException(
        'You do not have permission to access this report type',
      );
    }

    // If linked to an employee snapshot that was deactivated, revoke access.
    const linkedEmployee = await this.prisma.employeeSnapshot.findFirst({
      where: {
        tenantId: actor.tenantId,
        OR: [
          { userId: actor.userId },
          ...(recipient.employeeId ? [{ employeeId: recipient.employeeId }] : []),
        ],
      },
    });
    if (linkedEmployee && !linkedEmployee.isActive) {
      throw new ForbiddenException('Assigned employee profile is inactive');
    }
  }

  /**
   * Computes which site-level report email actions the actor is authorized to use
   * on `siteId`. Accessible only to:
   * 1) The tenant `owner` (all sites).
   * 2) Users included in `siteId` to whom the `owner` granted administrator /
   *    report permissions (e.g. HR staff of the site via `ReportRecipient` or
   *    site-included `admin`).
   */
  async getSiteEmailPermissions(
    actor: VerifiedActor,
    siteId: string,
  ): Promise<SiteReportEmailPermissions> {
    if (actor.role === 'platform_admin' || !actor.tenantId) {
      return {
        canAccessPanel: false,
        canRequestDaily: false,
        canRequestMonthly: false,
        canRequestPayrollExcel: false,
      };
    }

    if (actor.role === 'owner') {
      return {
        canAccessPanel: true,
        canRequestDaily: true,
        canRequestMonthly: true,
        canRequestPayrollExcel: true,
      };
    }

    const [recipient, linkedEmployee] = await Promise.all([
      this.prisma.reportRecipient.findUnique({
        where: {
          tenantId_userId: {
            tenantId: actor.tenantId,
            userId: actor.userId,
          },
        },
      }),
      this.prisma.employeeSnapshot.findFirst({
        where: {
          tenantId: actor.tenantId,
          userId: actor.userId,
        },
      }),
    ]);

    if (linkedEmployee && !linkedEmployee.isActive) {
      return {
        canAccessPanel: false,
        canRequestDaily: false,
        canRequestMonthly: false,
        canRequestPayrollExcel: false,
      };
    }

    const empSiteIds = linkedEmployee?.siteIds ?? [];
    const recSiteIds = recipient?.siteIds ?? [];

    const includedInSite =
      empSiteIds.includes(siteId) ||
      recSiteIds.includes(siteId) ||
      (actor.siteIds?.includes(siteId) ?? false);

    if (!includedInSite) {
      return {
        canAccessPanel: false,
        canRequestDaily: false,
        canRequestMonthly: false,
        canRequestPayrollExcel: false,
      };
    }

    if (recSiteIds.length > 0 && !recSiteIds.includes(siteId)) {
      return {
        canAccessPanel: false,
        canRequestDaily: false,
        canRequestMonthly: false,
        canRequestPayrollExcel: false,
      };
    }

    if (recipient) {
      const canAccessPanel =
        recipient.receiveDaily ||
        recipient.receiveMonthly ||
        recipient.receivePayrollExcel;
      return {
        canAccessPanel,
        canRequestDaily: recipient.receiveDaily,
        canRequestMonthly: recipient.receiveMonthly,
        canRequestPayrollExcel: recipient.receivePayrollExcel,
      };
    }

    if (actor.role === 'admin') {
      return {
        canAccessPanel: true,
        canRequestDaily: true,
        canRequestMonthly: true,
        canRequestPayrollExcel: true,
      };
    }

    return {
      canAccessPanel: false,
      canRequestDaily: false,
      canRequestMonthly: false,
      canRequestPayrollExcel: false,
    };
  }

  /**
   * Enforces site-level report email permission for `siteId` and `kind`.
   */
  async authorizeSiteReportEmailRequest(
    actor: VerifiedActor,
    siteId: string,
    kind: ReportKind,
  ): Promise<void> {
    const perms = await this.getSiteEmailPermissions(actor, siteId);
    if (!perms.canAccessPanel) {
      throw new ForbiddenException(
        'Solo el Owner o usuarios incluidos en esta sede con permiso de administrador otorgado por el Owner pueden solicitar informes de la sede',
      );
    }

    const allowed =
      kind === 'daily'
        ? perms.canRequestDaily
        : kind === 'monthly'
          ? perms.canRequestMonthly
          : perms.canRequestPayrollExcel;

    if (!allowed) {
      throw new ForbiddenException(
        'No tenés permiso habilitado por el Owner para solicitar este tipo de informe en esta sede',
      );
    }
  }

  /**
   * Resolves all assigned active recipient `userId`s for a given report kind
   * (so automated report jobs can include them alongside the owner in notifications).
   */
  async resolveNotificationRecipientUserIds(
    tenantId: string,
    kind: ReportKind,
  ): Promise<string[]> {
    const where: Record<string, unknown> = { tenantId };
    if (kind === 'daily') where.receiveDaily = true;
    else if (kind === 'monthly') where.receiveMonthly = true;
    else where.receivePayrollExcel = true;

    const [recipients, employees] = await Promise.all([
      this.prisma.reportRecipient.findMany({ where }),
      this.prisma.employeeSnapshot.findMany({ where: { tenantId } }),
    ]);

    const inactiveUsers = new Set(
      employees
        .filter((e) => !e.isActive && e.userId)
        .map((e) => e.userId!),
    );

    return recipients
      .map((r) => r.userId)
      .filter((uid) => !inactiveUsers.has(uid));
  }

  async listRecipients(actor: VerifiedActor): Promise<{
    items: ReportRecipientView[];
    assignableEmployees: {
      employeeId: string;
      userId: string;
      fullName: string;
      employeeNumber: string | null;
      siteIds: string[];
    }[];
  }> {
    if (actor.role !== 'owner') {
      throw new ForbiddenException(
        'Only the organization owner can manage report recipients',
      );
    }

    await this.snapshots.ensureTenantCatalogSynced(actor.tenantId);

    const [recipients, employees] = await Promise.all([
      this.prisma.reportRecipient.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.employeeSnapshot.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
    ]);

    const empByUser = new Map(
      employees.filter((e) => e.userId).map((e) => [e.userId!, e]),
    );
    const empById = new Map(employees.map((e) => [e.employeeId, e]));

    const items: ReportRecipientView[] = recipients.map((rec) => {
      const emp =
        (rec.employeeId ? empById.get(rec.employeeId) : undefined) ??
        empByUser.get(rec.userId);
      const mergedSiteIds =
        rec.siteIds && rec.siteIds.length > 0
          ? rec.siteIds
          : (emp?.siteIds ?? []);
      return {
        id: rec.id,
        tenantId: rec.tenantId,
        userId: rec.userId,
        employeeId: rec.employeeId ?? emp?.employeeId ?? null,
        employeeName: emp ? `${emp.lastName}, ${emp.firstName}` : null,
        employeeNumber: emp?.employeeNumber ?? null,
        siteIds: mergedSiteIds,
        isActiveEmployee: emp ? emp.isActive : true,
        receiveDaily: rec.receiveDaily,
        receiveMonthly: rec.receiveMonthly,
        receivePayrollExcel: rec.receivePayrollExcel,
        assignedByUserId: rec.assignedByUserId,
        updatedAt: rec.updatedAt.toISOString(),
      };
    });

    const assignableEmployees = employees
      .filter((e) => e.isActive && e.userId !== null)
      .map((e) => ({
        employeeId: e.employeeId,
        userId: e.userId!,
        fullName: `${e.lastName}, ${e.firstName}`,
        employeeNumber: e.employeeNumber,
        siteIds: e.siteIds ?? [],
      }));

    return { items, assignableEmployees };
  }

  async upsertRecipient(
    actor: VerifiedActor,
    targetUserId: string,
    dto: UpsertReportRecipientDto,
  ): Promise<ReportRecipientView> {
    if (actor.role !== 'owner') {
      throw new ForbiddenException(
        'Only the organization owner can assign report recipients',
      );
    }

    await this.snapshots.ensureTenantCatalogSynced(actor.tenantId);

    const emp = await this.prisma.employeeSnapshot.findFirst({
      where: {
        tenantId: actor.tenantId,
        OR: [
          { userId: targetUserId },
          ...(dto.employeeId ? [{ employeeId: dto.employeeId }] : []),
        ],
      },
    });

    if (emp && !emp.isActive) {
      throw new EmployeeNotFoundException();
    }

    const normalizedSiteIds = dto.siteIds
      ? [...new Set(dto.siteIds)]
      : (emp?.siteIds ?? []);

    const saved = await this.prisma.reportRecipient.upsert({
      where: {
        tenantId_userId: {
          tenantId: actor.tenantId,
          userId: targetUserId,
        },
      },
      update: {
        employeeId: dto.employeeId ?? emp?.employeeId ?? null,
        ...(dto.siteIds !== undefined ? { siteIds: normalizedSiteIds } : {}),
        receiveDaily: dto.receiveDaily,
        receiveMonthly: dto.receiveMonthly,
        receivePayrollExcel: dto.receivePayrollExcel,
        assignedByUserId: actor.userId,
      },
      create: {
        tenantId: actor.tenantId,
        userId: targetUserId,
        employeeId: dto.employeeId ?? emp?.employeeId ?? null,
        siteIds: normalizedSiteIds,
        receiveDaily: dto.receiveDaily,
        receiveMonthly: dto.receiveMonthly,
        receivePayrollExcel: dto.receivePayrollExcel,
        assignedByUserId: actor.userId,
      },
    });

    return {
      id: saved.id,
      tenantId: saved.tenantId,
      userId: saved.userId,
      employeeId: saved.employeeId,
      employeeName: emp ? `${emp.lastName}, ${emp.firstName}` : null,
      employeeNumber: emp?.employeeNumber ?? null,
      siteIds: saved.siteIds ?? normalizedSiteIds,
      isActiveEmployee: emp ? emp.isActive : true,
      receiveDaily: saved.receiveDaily,
      receiveMonthly: saved.receiveMonthly,
      receivePayrollExcel: saved.receivePayrollExcel,
      assignedByUserId: saved.assignedByUserId,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async removeRecipient(
    actor: VerifiedActor,
    targetUserId: string,
  ): Promise<{ deleted: boolean }> {
    if (actor.role !== 'owner') {
      throw new ForbiddenException(
        'Only the organization owner can remove report recipients',
      );
    }

    const { count } = await this.prisma.reportRecipient.deleteMany({
      where: {
        tenantId: actor.tenantId,
        userId: targetUserId,
      },
    });
    return { deleted: count > 0 };
  }
}
