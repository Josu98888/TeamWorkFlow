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
  isActiveEmployee: boolean;
  receiveDaily: boolean;
  receiveMonthly: boolean;
  receivePayrollExcel: boolean;
  assignedByUserId: string;
  updatedAt: string;
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
      return {
        id: rec.id,
        tenantId: rec.tenantId,
        userId: rec.userId,
        employeeId: rec.employeeId ?? emp?.employeeId ?? null,
        employeeName: emp ? `${emp.lastName}, ${emp.firstName}` : null,
        employeeNumber: emp?.employeeNumber ?? null,
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

    const saved = await this.prisma.reportRecipient.upsert({
      where: {
        tenantId_userId: {
          tenantId: actor.tenantId,
          userId: targetUserId,
        },
      },
      update: {
        employeeId: dto.employeeId ?? emp?.employeeId ?? null,
        receiveDaily: dto.receiveDaily,
        receiveMonthly: dto.receiveMonthly,
        receivePayrollExcel: dto.receivePayrollExcel,
        assignedByUserId: actor.userId,
      },
      create: {
        tenantId: actor.tenantId,
        userId: targetUserId,
        employeeId: dto.employeeId ?? emp?.employeeId ?? null,
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
