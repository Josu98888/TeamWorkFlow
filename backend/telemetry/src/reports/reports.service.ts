import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/attendance-client';

import {
  EmployeeNotFoundException,
  SiteNotFoundException,
  ValidationException,
} from '../common/exceptions/app.exceptions';
import { getEnv } from '../config/envs';
import { AuthUser } from '../http/interfaces/auth-user.interface';
import { JetstreamPublisherService } from '../nats/jetstream-publisher.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrgSnapshotsService } from '../snapshots/org-snapshots.service';
import {
  buildDailyReportPayload,
  DailyReportPayload,
} from './domain/daily-report-builder';
import {
  buildMonthlyAttendanceReport,
  MonthlyAttendanceReportPayload,
} from './domain/monthly-report-builder';
import {
  calculateMonthlyPayroll,
  MonthlyPayrollPreview,
} from './domain/payroll-calculator';
import {
  formatDateInTz,
  formatYearMonthInTz,
  getDayUtcBoundsInTz,
  getMonthUtcBoundsInTz,
  isCalendarDate,
  isYearMonth,
} from './domain/timezone-range';
import {
  CloseMonthlyPayrollRunDto,
  DailyReportQueryDto,
  MonthlyReportQueryDto,
  ReportHistoryQueryDto,
} from './dto/reports.dto';
import { ExcelPayrollExporter } from './export/excel-payroll-exporter';
import { PdfReportExporter } from './export/pdf-report-exporter';
import { ReportRecipientsService } from './report-recipients.service';
import { REPORTS_EVENTS } from './reports.patterns';

const DAY_MS = 24 * 60 * 60_000;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: OrgSnapshotsService,
    private readonly recipients: ReportRecipientsService,
    private readonly pdfExporter: PdfReportExporter,
    private readonly excelExporter: ExcelPayrollExporter,
    private readonly jetstream: JetstreamPublisherService,
  ) {}

  async getDailyReport(
    actor: AuthUser,
    query: DailyReportQueryDto,
  ): Promise<DailyReportPayload> {
    await this.recipients.authorizeReportAccess(actor, 'daily');
    const defaultTz = getEnv().DEFAULT_REPORT_TZ;
    const reportDate = query.date ?? formatDateInTz(new Date(), defaultTz);
    if (!isCalendarDate(reportDate)) {
      throw new ValidationException('date must be in YYYY-MM-DD format');
    }

    return this.computeDailyReport(actor.tenantId, reportDate, query.siteId);
  }

  async exportDailyPdf(
    actor: AuthUser,
    query: DailyReportQueryDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.getDailyReport(actor, query);
    const buffer = this.pdfExporter.generateDailyPdf(report);
    return {
      buffer,
      filename: `informe-diario-${report.reportDate}.pdf`,
    };
  }

  async listDailyHistory(actor: AuthUser, query: ReportHistoryQueryDto) {
    await this.recipients.authorizeReportAccess(actor, 'daily');
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.dailyAttendanceReport.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: { reportDate: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.dailyAttendanceReport.count({
        where: { tenantId: actor.tenantId },
      }),
    ]);

    return { items, total, limit, offset };
  }

  async generateAndSaveDailySnapshot(
    tenantId: string,
    reportDate: string,
    now: Date = new Date(),
  ) {
    const report = await this.computeDailyReport(
      tenantId,
      reportDate,
      undefined,
      now,
    );
    const saved = await this.prisma.dailyAttendanceReport.upsert({
      where: {
        tenantId_reportDate_siteKey: {
          tenantId,
          reportDate,
          siteKey: 'ALL',
        },
      },
      create: {
        tenantId,
        reportDate,
        siteKey: 'ALL',
        timezone: report.timezone,
        scheduledShiftsCount: report.summary.scheduledShiftsCount,
        presentCount: report.summary.presentCount,
        absentCount: report.summary.absentCount,
        outOfGeofenceCount: report.summary.outOfGeofenceCount,
        payload: report as unknown as Prisma.InputJsonValue,
      },
      update: {
        timezone: report.timezone,
        scheduledShiftsCount: report.summary.scheduledShiftsCount,
        presentCount: report.summary.presentCount,
        absentCount: report.summary.absentCount,
        outOfGeofenceCount: report.summary.outOfGeofenceCount,
        payload: report as unknown as Prisma.InputJsonValue,
        generatedAt: now,
      },
    });

    const recipientUserIds =
      await this.recipients.resolveNotificationRecipientUserIds(
        tenantId,
        'daily',
      );
    await this.jetstream.publish(
      tenantId,
      REPORTS_EVENTS.DAILY_REPORT_READY,
      {
        reportId: saved.id,
        reportDate,
        absentCount: report.summary.absentCount,
        outOfGeofenceCount: report.summary.outOfGeofenceCount,
        recipientUserIds,
      },
      { aggregateId: saved.id },
    );

    return saved;
  }

  async getMonthlyReport(
    actor: AuthUser,
    query: MonthlyReportQueryDto,
  ): Promise<MonthlyAttendanceReportPayload> {
    await this.recipients.authorizeReportAccess(actor, 'monthly');
    const defaultTz = getEnv().DEFAULT_REPORT_TZ;
    const period = query.period ?? formatYearMonthInTz(new Date(), defaultTz);
    if (!isYearMonth(period)) {
      throw new ValidationException('period must be in YYYY-MM format');
    }

    return this.computeMonthlyReport(
      actor.tenantId,
      period,
      query.siteId,
      query.employeeId,
    );
  }

  async exportMonthlyPdf(
    actor: AuthUser,
    query: MonthlyReportQueryDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.getMonthlyReport(actor, query);
    const buffer = this.pdfExporter.generateMonthlyPdf(report);
    return {
      buffer,
      filename: `informe-mensual-${report.period}.pdf`,
    };
  }

  async getEmployeeMonthlyDetail(
    actor: AuthUser,
    employeeId: string,
    query: MonthlyReportQueryDto,
  ) {
    const report = await this.getMonthlyReport(actor, {
      ...query,
      employeeId,
    });
    return {
      period: report.period,
      timezone: report.timezone,
      employee: report.employees[0] ?? null,
      shifts: report.shiftsByEmployee[employeeId] ?? [],
      outOfGeofenceEvents: report.outOfGeofenceEvents,
    };
  }

  async listMonthlyHistory(actor: AuthUser, query: ReportHistoryQueryDto) {
    await this.recipients.authorizeReportAccess(actor, 'monthly');
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.monthlyAttendanceReport.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: { period: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.monthlyAttendanceReport.count({
        where: { tenantId: actor.tenantId },
      }),
    ]);

    return { items, total, limit, offset };
  }

  async generateAndSaveMonthlySnapshot(
    tenantId: string,
    period: string,
    now: Date = new Date(),
  ) {
    const report = await this.computeMonthlyReport(
      tenantId,
      period,
      undefined,
      undefined,
      now,
    );
    const saved = await this.prisma.monthlyAttendanceReport.upsert({
      where: {
        tenantId_period_siteKey: {
          tenantId,
          period,
          siteKey: 'ALL',
        },
      },
      create: {
        tenantId,
        period,
        siteKey: 'ALL',
        timezone: report.timezone,
        employeesCount: report.summary.employeesCount,
        scheduledShiftsCount: report.summary.scheduledShiftsCount,
        attendedShiftsCount: report.summary.attendedShiftsCount,
        absentShiftsCount: report.summary.absentShiftsCount,
        outOfGeofenceCount: report.summary.outOfGeofenceCount,
        totalWorkedMinutes: report.summary.totalWorkedMinutes,
        totalOvertimeMinutes: report.summary.totalOvertimeMinutes,
        payload: report as unknown as Prisma.InputJsonValue,
      },
      update: {
        timezone: report.timezone,
        employeesCount: report.summary.employeesCount,
        scheduledShiftsCount: report.summary.scheduledShiftsCount,
        attendedShiftsCount: report.summary.attendedShiftsCount,
        absentShiftsCount: report.summary.absentShiftsCount,
        outOfGeofenceCount: report.summary.outOfGeofenceCount,
        totalWorkedMinutes: report.summary.totalWorkedMinutes,
        totalOvertimeMinutes: report.summary.totalOvertimeMinutes,
        payload: report as unknown as Prisma.InputJsonValue,
        generatedAt: now,
      },
    });

    const recipientUserIds =
      await this.recipients.resolveNotificationRecipientUserIds(
        tenantId,
        'monthly',
      );
    await this.jetstream.publish(
      tenantId,
      REPORTS_EVENTS.MONTHLY_REPORT_READY,
      {
        reportId: saved.id,
        period,
        employeesCount: report.summary.employeesCount,
        attendedShiftsCount: report.summary.attendedShiftsCount,
        absentShiftsCount: report.summary.absentShiftsCount,
        outOfGeofenceCount: report.summary.outOfGeofenceCount,
        recipientUserIds,
      },
      { aggregateId: saved.id },
    );

    return saved;
  }

  async getMonthlyPayrollPreview(
    actor: AuthUser,
    query: MonthlyReportQueryDto,
  ): Promise<MonthlyPayrollPreview> {
    await this.recipients.authorizeReportAccess(actor, 'payroll_excel');
    const defaultTz = getEnv().DEFAULT_REPORT_TZ;
    const period = query.period ?? formatYearMonthInTz(new Date(), defaultTz);
    if (!isYearMonth(period)) {
      throw new ValidationException('period must be in YYYY-MM format');
    }

    const [attendanceReport, compensations, postRates] = await Promise.all([
      this.computeMonthlyReport(
        actor.tenantId,
        period,
        query.siteId,
        query.employeeId,
      ),
      this.prisma.employeeCompensation.findMany({
        where: { tenantId: actor.tenantId },
      }),
      this.prisma.postOvertimeRate.findMany({
        where: { tenantId: actor.tenantId },
      }),
    ]);

    return calculateMonthlyPayroll({
      attendanceReport,
      compensationsByEmployeeId: new Map(
        compensations.map((c) => [c.employeeId, c]),
      ),
      overtimeRatesByPostId: new Map(postRates.map((r) => [r.postId, r])),
      currency: 'ARS',
    });
  }

  async exportMonthlyPayrollExcel(
    actor: AuthUser,
    query: MonthlyReportQueryDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const payroll = await this.getMonthlyPayrollPreview(actor, query);
    const buffer = await this.excelExporter.generatePayrollWorkbook(payroll);
    return {
      buffer,
      filename: `liquidacion-asistencia-${payroll.period}.xlsx`,
    };
  }

  async closeMonthlyPayrollRun(
    actor: AuthUser,
    dto: CloseMonthlyPayrollRunDto,
  ) {
    const preview = await this.getMonthlyPayrollPreview(actor, dto);
    const siteKey = dto.siteId ?? 'ALL';

    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.monthlyPayrollRun.findUnique({
        where: {
          tenantId_period_siteKey: {
            tenantId: actor.tenantId,
            period: preview.period,
            siteKey,
          },
        },
      });
      if (existing) {
        await tx.monthlyPayrollLine.deleteMany({
          where: { payrollRunId: existing.id },
        });
      }

      const run = await tx.monthlyPayrollRun.upsert({
        where: {
          tenantId_period_siteKey: {
            tenantId: actor.tenantId,
            period: preview.period,
            siteKey,
          },
        },
        create: {
          tenantId: actor.tenantId,
          period: preview.period,
          siteKey,
          status: 'CLOSED',
          currency: preview.currency,
          employeesCount: preview.summary.employeesCount,
          unconfiguredEmployeesCount:
            preview.summary.unconfiguredEmployeesCount,
          totalRegularMinutes: preview.summary.totalRegularMinutes,
          totalOvertimeMinutes: preview.summary.totalOvertimeMinutes,
          totalBasePayAmount: new Prisma.Decimal(
            preview.summary.totalBasePayAmount,
          ),
          totalOvertimePayAmount: new Prisma.Decimal(
            preview.summary.totalOvertimePayAmount,
          ),
          totalPayAmount: new Prisma.Decimal(preview.summary.totalPayAmount),
          closedByUserId: actor.userId,
          closedAt: new Date(),
        },
        update: {
          status: 'CLOSED',
          currency: preview.currency,
          employeesCount: preview.summary.employeesCount,
          unconfiguredEmployeesCount:
            preview.summary.unconfiguredEmployeesCount,
          totalRegularMinutes: preview.summary.totalRegularMinutes,
          totalOvertimeMinutes: preview.summary.totalOvertimeMinutes,
          totalBasePayAmount: new Prisma.Decimal(
            preview.summary.totalBasePayAmount,
          ),
          totalOvertimePayAmount: new Prisma.Decimal(
            preview.summary.totalOvertimePayAmount,
          ),
          totalPayAmount: new Prisma.Decimal(preview.summary.totalPayAmount),
          closedByUserId: actor.userId,
          closedAt: new Date(),
        },
      });

      if (preview.employees.length > 0) {
        await tx.monthlyPayrollLine.createMany({
          data: preview.employees.map((line) => ({
            payrollRunId: run.id,
            tenantId: actor.tenantId,
            employeeId: line.employeeId,
            employeeFullName: line.fullName,
            employeeDni: line.dni,
            scheduledShiftsCount: line.scheduledShiftsCount,
            attendedShiftsCount: line.attendedShiftsCount,
            absentShiftsCount: line.absentShiftsCount,
            incompleteShiftsCount: line.incompleteShiftsCount,
            outOfGeofenceCount: line.outOfGeofenceCount,
            regularWorkedMinutes: line.regularWorkedMinutes,
            overtimeWorkedMinutes: line.overtimeWorkedMinutes,
            totalWorkedMinutes: line.totalWorkedMinutes,
            payRateType: line.payRateType,
            hourlyRate:
              line.hourlyRate !== null
                ? new Prisma.Decimal(line.hourlyRate)
                : null,
            shiftRate:
              line.shiftRate !== null
                ? new Prisma.Decimal(line.shiftRate)
                : null,
            basePayAmount: new Prisma.Decimal(line.basePayAmount),
            overtimePayAmount: new Prisma.Decimal(line.overtimePayAmount),
            totalPayAmount: new Prisma.Decimal(line.totalPayAmount),
            isRateConfigured: line.isRateConfigured,
            postBreakdown:
              line.postBreakdown as unknown as Prisma.InputJsonValue,
          })),
        });
      }

      return tx.monthlyPayrollRun.findUniqueOrThrow({
        where: { id: run.id },
        include: { lines: true },
      });
    });

    const recipientUserIds =
      await this.recipients.resolveNotificationRecipientUserIds(
        actor.tenantId,
        'payroll_excel',
      );
    await this.jetstream.publish(
      actor.tenantId,
      REPORTS_EVENTS.PAYROLL_REPORT_READY,
      {
        payrollRunId: saved.id,
        period: saved.period,
        currency: saved.currency,
        employeesCount: saved.employeesCount,
        totalPayAmount: saved.totalPayAmount.toFixed(2),
        recipientUserIds,
      },
      { aggregateId: saved.id },
    );

    return saved;
  }

  async listPayrollRuns(actor: AuthUser, query: ReportHistoryQueryDto) {
    await this.recipients.authorizeReportAccess(actor, 'payroll_excel');
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.monthlyPayrollRun.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: { period: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.monthlyPayrollRun.count({
        where: { tenantId: actor.tenantId },
      }),
    ]);

    return { items, total, limit, offset };
  }

  private async loadTenantCatalog(
    tenantId: string,
    siteId?: string,
    employeeId?: string,
  ) {
    await this.snapshots.ensureTenantCatalogSynced(tenantId);
    const [sites, posts, employees] = await Promise.all([
      this.prisma.siteSnapshot.findMany({ where: { tenantId } }),
      this.prisma.postSnapshot.findMany({ where: { tenantId } }),
      this.prisma.employeeSnapshot.findMany({ where: { tenantId } }),
    ]);

    const sitesById = new Map(sites.map((s) => [s.id, s]));
    const postsById = new Map(posts.map((p) => [p.id, p]));
    const employeesById = new Map(employees.map((e) => [e.id, e]));

    if (siteId && !sitesById.has(siteId)) {
      throw new SiteNotFoundException(siteId);
    }
    if (employeeId && !employeesById.has(employeeId)) {
      throw new EmployeeNotFoundException(employeeId);
    }

    return { sitesById, postsById, employeesById };
  }

  private async computeDailyReport(
    tenantId: string,
    reportDate: string,
    siteId?: string,
    now: Date = new Date(),
  ): Promise<DailyReportPayload> {
    const defaultTimezone = getEnv().DEFAULT_REPORT_TZ;
    const { sitesById, postsById, employeesById } =
      await this.loadTenantCatalog(tenantId, siteId);

    const bounds = getDayUtcBoundsInTz(reportDate, defaultTimezone);
    const paddedStart = new Date(bounds.startUtc.getTime() - DAY_MS);
    const paddedEnd = new Date(bounds.endUtc.getTime() + DAY_MS);

    const [shifts, clockEvents, workdays, alerts] = await Promise.all([
      this.prisma.shiftSnapshot.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          startsAt: { gte: paddedStart, lte: paddedEnd },
        },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.clockEvent.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          occurredAt: { gte: paddedStart, lte: paddedEnd },
        },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.workday.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          startsAt: { gte: paddedStart, lte: paddedEnd },
        },
      }),
      this.prisma.alert.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          triggeredAt: { gte: paddedStart, lte: paddedEnd },
        },
      }),
    ]);

    return buildDailyReportPayload({
      reportDate,
      defaultTimezone,
      siteId,
      now,
      shifts,
      workdays,
      clockEvents,
      alerts,
      sitesById,
      postsById,
      employeesById,
    });
  }

  private async computeMonthlyReport(
    tenantId: string,
    period: string,
    siteId?: string,
    employeeId?: string,
    now: Date = new Date(),
  ): Promise<MonthlyAttendanceReportPayload> {
    const defaultTimezone = getEnv().DEFAULT_REPORT_TZ;
    const { sitesById, postsById, employeesById } =
      await this.loadTenantCatalog(tenantId, siteId, employeeId);

    const bounds = getMonthUtcBoundsInTz(period, defaultTimezone);
    const paddedStart = new Date(bounds.startUtc.getTime() - DAY_MS);
    const paddedEnd = new Date(bounds.endUtc.getTime() + DAY_MS);

    const [shifts, clockEvents, workdays, alerts] = await Promise.all([
      this.prisma.shiftSnapshot.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          ...(employeeId ? { employeeId } : {}),
          startsAt: { gte: paddedStart, lte: paddedEnd },
        },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.clockEvent.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          ...(employeeId ? { employeeId } : {}),
          occurredAt: { gte: paddedStart, lte: paddedEnd },
        },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.workday.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          ...(employeeId ? { employeeId } : {}),
          startsAt: { gte: paddedStart, lte: paddedEnd },
        },
      }),
      this.prisma.alert.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          ...(employeeId ? { employeeId } : {}),
          triggeredAt: { gte: paddedStart, lte: paddedEnd },
        },
      }),
    ]);

    return buildMonthlyAttendanceReport({
      period,
      defaultTimezone,
      siteId,
      employeeId,
      now,
      shifts,
      workdays,
      clockEvents,
      alerts,
      sitesById,
      postsById,
      employeesById,
    });
  }
}
