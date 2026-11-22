import { Injectable } from '@nestjs/common';

import {
  EmployeeNotFoundException,
  SiteNotFoundException,
  ValidationException,
} from '../common/exceptions';
import { envs } from '../config';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { JetStreamService } from '../nats/jetstream.service';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { Prisma } from '../prisma/generated/client';
import { OrgSnapshotsService } from '../snapshots/org-snapshots.service';
import {
  buildDailyReportPayload,
  type DailyAttendanceReportPayload,
} from './domain/daily-report-builder';
import {
  buildMonthlyAttendanceReport,
  type MonthlyAttendanceReportPayload,
} from './domain/monthly-report-builder';
import {
  calculateMonthlyPayroll,
  type MonthlyPayrollCalculation,
} from './domain/payroll-calculator';
import {
  dayRangeInTz,
  formatDateInTz,
  formatYearMonthInTz,
  isCalendarDate,
  isYearMonth,
  monthRangeInTz,
} from './domain/timezone-range';
import type {
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
    private readonly prisma: AttendancePrismaService,
    private readonly snapshots: OrgSnapshotsService,
    private readonly recipients: ReportRecipientsService,
    private readonly pdfExporter: PdfReportExporter,
    private readonly excelExporter: ExcelPayrollExporter,
    private readonly jetstream: JetStreamService,
  ) {}

  async getDailyReport(
    actor: VerifiedActor,
    query: DailyReportQueryDto,
  ): Promise<DailyAttendanceReportPayload> {
    await this.recipients.authorizeReportAccess(actor, 'daily');
    const reportDate =
      query.date ?? formatDateInTz(new Date(), envs.defaultReportTz);
    if (!isCalendarDate(reportDate)) {
      throw new ValidationException([
        { field: 'date', constraints: ['date must be in YYYY-MM-DD format'] },
      ]);
    }

    return this.computeDailyReport(actor.tenantId, reportDate, query.siteId);
  }

  async exportDailyPdf(
    actor: VerifiedActor,
    query: DailyReportQueryDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.getDailyReport(actor, query);
    const buffer = this.pdfExporter.generateDailyPdf(report);
    return {
      buffer,
      filename: `informe-diario-${report.reportDate}.pdf`,
    };
  }

  async listDailyHistory(actor: VerifiedActor, query: ReportHistoryQueryDto) {
    await this.recipients.authorizeReportAccess(actor, 'daily');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.dailyAttendanceReport.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: { reportDate: 'desc' },
        take: pageSize,
        skip,
      }),
      this.prisma.dailyAttendanceReport.count({
        where: { tenantId: actor.tenantId },
      }),
    ]);

    return { items, total, page, pageSize };
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

    const saved = await this.prisma.dailyAttendanceReport.create({
      data: {
        tenantId,
        reportDate,
        siteId: null,
        totalAssignedShifts: report.summary.totalAssignedShifts,
        attendedShifts: report.summary.attendedShifts,
        absentCount: report.summary.absentCount,
        outOfGeofenceCount: report.summary.outOfGeofenceCount,
        missingClockOutCount: report.summary.missingClockOutCount,
        payload: report as unknown as Prisma.InputJsonValue,
        generatedAt: now,
      },
    });

    const recipientUserIds =
      await this.recipients.resolveNotificationRecipientUserIds(
        tenantId,
        'daily',
      );
    await this.jetstream.publish(tenantId, REPORTS_EVENTS.DAILY_REPORT_READY, {
      reportId: saved.id,
      reportDate,
      absentCount: report.summary.absentCount,
      outOfGeofenceCount: report.summary.outOfGeofenceCount,
      recipientUserIds,
    });

    return saved;
  }

  async getMonthlyReport(
    actor: VerifiedActor,
    query: MonthlyReportQueryDto,
  ): Promise<MonthlyAttendanceReportPayload> {
    await this.recipients.authorizeReportAccess(actor, 'monthly');
    const period =
      query.period ?? formatYearMonthInTz(new Date(), envs.defaultReportTz);
    if (!isYearMonth(period)) {
      throw new ValidationException([
        { field: 'period', constraints: ['period must be in YYYY-MM format'] },
      ]);
    }

    return this.computeMonthlyReport(
      actor.tenantId,
      period,
      query.siteId,
      query.employeeId,
    );
  }

  async exportMonthlyPdf(
    actor: VerifiedActor,
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
    actor: VerifiedActor,
    employeeId: string,
    query: MonthlyReportQueryDto,
  ) {
    const report = await this.getMonthlyReport(actor, {
      period: query.period,
      siteId: query.siteId,
      employeeId,
    });
    return {
      period: report.period,
      employee: report.employees[0] ?? null,
      shifts: report.shiftsByEmployee[employeeId] ?? [],
      outOfGeofenceEvents: report.outOfGeofenceEvents,
    };
  }

  async listMonthlyHistory(
    actor: VerifiedActor,
    query: ReportHistoryQueryDto,
  ) {
    await this.recipients.authorizeReportAccess(actor, 'monthly');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.monthlyAttendanceReport.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: { period: 'desc' },
        take: pageSize,
        skip,
      }),
      this.prisma.monthlyAttendanceReport.count({
        where: { tenantId: actor.tenantId },
      }),
    ]);

    return { items, total, page, pageSize };
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
    const saved = await this.prisma.monthlyAttendanceReport.create({
      data: {
        tenantId,
        period,
        siteId: null,
        employeesCount: report.summary.employeesCount,
        totalAttendedShifts: report.summary.totalAttendedShifts,
        totalAbsentShifts: report.summary.totalAbsentShifts,
        totalOutOfGeofence: report.summary.totalOutOfGeofence,
        totalMissingClockOuts: report.summary.totalMissingClockOuts,
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
        attendedShiftsCount: report.summary.totalAttendedShifts,
        absentShiftsCount: report.summary.totalAbsentShifts,
        outOfGeofenceCount: report.summary.totalOutOfGeofence,
        recipientUserIds,
      },
    );

    return saved;
  }

  async getMonthlyPayrollPreview(
    actor: VerifiedActor,
    query: MonthlyReportQueryDto,
  ): Promise<MonthlyPayrollCalculation> {
    await this.recipients.authorizeReportAccess(actor, 'payroll_excel');
    const period =
      query.period ?? formatYearMonthInTz(new Date(), envs.defaultReportTz);
    if (!isYearMonth(period)) {
      throw new ValidationException([
        { field: 'period', constraints: ['period must be in YYYY-MM format'] },
      ]);
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
      employeeRates: new Map(
        compensations.map((c) => [
          c.employeeId,
          {
            payType: c.payType,
            baseRate: c.baseRate,
            currency: c.currency,
          },
        ]),
      ),
      postOvertimeRates: new Map(
        postRates.map((r) => [
          r.postId,
          {
            overtimeHourlyRate: r.overtimeHourlyRate,
            currency: r.currency,
          },
        ]),
      ),
    });
  }

  async exportMonthlyPayrollExcel(
    actor: VerifiedActor,
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
    actor: VerifiedActor,
    dto: CloseMonthlyPayrollRunDto,
  ) {
    const preview = await this.getMonthlyPayrollPreview(actor, {
      period: dto.period,
      siteId: dto.siteId,
    });

    const saved = await this.prisma.$transaction(async (tx) => {
      const run = await tx.monthlyPayrollRun.create({
        data: {
          tenantId: actor.tenantId,
          period: preview.period,
          siteId: dto.siteId ?? null,
          currency: preview.currency,
          totalRegularPay: new Prisma.Decimal(preview.totals.totalRegularPay),
          totalOvertimePay: new Prisma.Decimal(preview.totals.totalOvertimePay),
          totalPay: new Prisma.Decimal(preview.totals.totalPay),
          warningsCount: preview.totals.warningsCount,
          generatedByUserId: actor.userId,
          status: 'CLOSED',
        },
      });

      if (preview.employees.length > 0) {
        await tx.monthlyPayrollLine.createMany({
          data: preview.employees.map((line) => ({
            tenantId: actor.tenantId,
            runId: run.id,
            employeeId: line.employeeId,
            employeeName: line.fullName,
            employeeNumber: line.employeeNumber,
            payType: line.payType,
            baseRateApplied:
              line.baseRateApplied !== null
                ? new Prisma.Decimal(line.baseRateApplied)
                : null,
            assignedShifts: line.totalAssignedShifts,
            attendedShifts: line.attendedShifts,
            absentShifts: line.absentCount,
            missingClockOutShifts: line.missingClockOutCount,
            fraudulentClockIns: line.outOfGeofenceCount,
            regularMinutes: line.totalRegularMinutes,
            overtimeMinutes: line.totalOvertimeMinutes,
            regularPay: new Prisma.Decimal(line.regularPay),
            overtimePay: new Prisma.Decimal(line.overtimePay),
            totalPay: new Prisma.Decimal(line.totalPay),
            observations: line.observations || null,
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
        employeesCount: preview.totals.employeesCount,
        totalPayAmount: saved.totalPay.toFixed(2),
        recipientUserIds,
      },
    );

    return saved;
  }

  async listPayrollRuns(actor: VerifiedActor, query: ReportHistoryQueryDto) {
    await this.recipients.authorizeReportAccess(actor, 'payroll_excel');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.monthlyPayrollRun.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: { period: 'desc' },
        take: pageSize,
        skip,
      }),
      this.prisma.monthlyPayrollRun.count({
        where: { tenantId: actor.tenantId },
      }),
    ]);

    return { items, total, page, pageSize };
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

    const sitesById = new Map(sites.map((s) => [s.siteId, s]));
    const postsById = new Map(posts.map((p) => [p.postId, p]));
    const employeesById = new Map(employees.map((e) => [e.employeeId, e]));

    if (siteId && !sitesById.has(siteId)) {
      throw new SiteNotFoundException();
    }
    if (employeeId && !employeesById.has(employeeId)) {
      throw new EmployeeNotFoundException();
    }

    return { sitesById, postsById, employeesById };
  }

  private async computeDailyReport(
    tenantId: string,
    reportDate: string,
    siteId?: string,
    now: Date = new Date(),
  ): Promise<DailyAttendanceReportPayload> {
    const defaultTz = envs.defaultReportTz;
    const { sitesById, postsById, employeesById } =
      await this.loadTenantCatalog(tenantId, siteId);

    const bounds = dayRangeInTz(reportDate, defaultTz);
    const paddedStart = new Date(bounds.start.getTime() - DAY_MS);
    const paddedEnd = new Date(bounds.end.getTime() + DAY_MS);

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
          deviceTime: { gte: paddedStart, lte: paddedEnd },
        },
        orderBy: { deviceTime: 'asc' },
      }),
      this.prisma.workday.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
        },
      }),
      this.prisma.alert.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          createdAt: { gte: paddedStart, lte: paddedEnd },
        },
      }),
    ]);

    return buildDailyReportPayload({
      reportDate,
      defaultTz,
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
    const defaultTz = envs.defaultReportTz;
    const { sitesById, postsById, employeesById } =
      await this.loadTenantCatalog(tenantId, siteId, employeeId);

    const bounds = monthRangeInTz(period, defaultTz);
    const paddedStart = new Date(bounds.start.getTime() - DAY_MS);
    const paddedEnd = new Date(bounds.end.getTime() + DAY_MS);

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
          deviceTime: { gte: paddedStart, lte: paddedEnd },
        },
        orderBy: { deviceTime: 'asc' },
      }),
      this.prisma.workday.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          ...(employeeId ? { employeeId } : {}),
        },
      }),
      this.prisma.alert.findMany({
        where: {
          tenantId,
          ...(siteId ? { siteId } : {}),
          ...(employeeId ? { employeeId } : {}),
          createdAt: { gte: paddedStart, lte: paddedEnd },
        },
      }),
    ]);

    return buildMonthlyAttendanceReport({
      period,
      defaultTz,
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
