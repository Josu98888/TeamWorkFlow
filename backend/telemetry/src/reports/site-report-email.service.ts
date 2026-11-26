import { Injectable } from '@nestjs/common';
import {
  FeatureNotInPlanException,
  ForbiddenException,
  ReportRequestDailyLimitReachedException,
  SiteNotFoundException,
  ValidationException,
} from '../common/exceptions';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { JetStreamService } from '../nats/jetstream.service';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import type { ReportEmailKind } from '../prisma/generated/client';
import { OrgSnapshotsService } from '../snapshots/org-snapshots.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import {
  dayRangeInTz,
  formatDateInTz,
  formatYearMonthInTz,
  isCalendarDate,
  isYearMonth,
} from './domain/timezone-range';
import type {
  RequestSiteReportEmailDto,
  SiteReportEmailKindDto,
} from './dto/reports.dto';
import { maskEmailAddress } from './mail/mail-provider.interface';
import { ReportMailService } from './mail/report-mail.service';
import {
  ReportRecipientsService,
  type ReportKind,
  type SiteReportEmailPermissions,
} from './report-recipients.service';
import { REPORTS_EVENTS } from './reports.patterns';
import { ReportsService } from './reports.service';

const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export interface SiteReportDailyQuotaItem {
  requested: boolean;
  sentAt: string | null;
  targetPeriod: string | null;
}

export interface SiteReportEmailStatusResponse {
  siteId: string;
  siteName: string;
  timezone: string;
  currentDateInSiteTz: string;
  nextAvailableDate: string;
  nextAvailableAt: string;
  recipientEmailMasked: string | null;
  hasProPlan: boolean;
  permissions: SiteReportEmailPermissions;
  requestedToday: {
    dailyAbsencesPdf: SiteReportDailyQuotaItem;
    monthlyAttendancePdf: SiteReportDailyQuotaItem;
    monthlyPayrollExcel: SiteReportDailyQuotaItem;
  };
}

export interface RequestSiteReportEmailResponse {
  requestId: string;
  siteId: string;
  siteName: string;
  kind: SiteReportEmailKindDto;
  targetPeriod: string;
  requestDate: string;
  sentAt: string;
  sentToEmailMasked: string;
  nextAvailableDate: string;
  nextAvailableAt: string;
}

function mapKindToEnums(kind: SiteReportEmailKindDto): {
  dbKind: ReportEmailKind;
  permKind: ReportKind;
  label: string;
} {
  switch (kind) {
    case 'daily_absences_pdf':
      return {
        dbKind: 'DAILY_ABSENCES_PDF',
        permKind: 'daily',
        label: 'Informe Diario de Faltas y Geocerca (PDF)',
      };
    case 'monthly_attendance_pdf':
      return {
        dbKind: 'MONTHLY_ATTENDANCE_PDF',
        permKind: 'monthly',
        label: 'Informe Mensual de Asistencia (PDF)',
      };
    case 'monthly_payroll_excel':
      return {
        dbKind: 'MONTHLY_PAYROLL_EXCEL',
        permKind: 'payroll_excel',
        label: 'Liquidación Mensual en Excel (.xlsx)',
      };
  }
}

@Injectable()
export class SiteReportEmailService {
  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly snapshots: OrgSnapshotsService,
    private readonly tenantState: TenantStateService,
    private readonly recipients: ReportRecipientsService,
    private readonly reportsService: ReportsService,
    private readonly mailService: ReportMailService,
    private readonly jetstream: JetStreamService,
  ) {}

  private async hasProPayrollFeature(actor: VerifiedActor): Promise<boolean> {
    if (actor.features?.payroll_reports === true) {
      return true;
    }
    if (actor.plan === 'pro') {
      return true;
    }
    if (!actor.tenantId) {
      return false;
    }
    return this.tenantState.hasFeature(actor.tenantId, 'payroll_reports');
  }

  async getSiteEmailRequestStatus(
    actor: VerifiedActor,
    siteId: string,
    now: Date = new Date(),
  ): Promise<SiteReportEmailStatusResponse> {
    if (actor.role === 'platform_admin' || !actor.tenantId) {
      throw new ForbiddenException();
    }

    await this.snapshots.ensureTenantCatalogSynced(actor.tenantId);
    const site = await this.prisma.siteSnapshot.findFirst({
      where: { tenantId: actor.tenantId, siteId },
    });
    if (!site) {
      throw new SiteNotFoundException();
    }

    const [permissions, hasProPlan] = await Promise.all([
      this.recipients.getSiteEmailPermissions(actor, siteId),
      this.hasProPayrollFeature(actor),
    ]);

    const currentDateInSiteTz = formatDateInTz(now, site.timezone);
    const bounds = dayRangeInTz(currentDateInSiteTz, site.timezone);
    const nextAvailableDate = formatDateInTz(
      new Date(bounds.end.getTime() + 60_000),
      site.timezone,
    );
    const nextAvailableAt = bounds.end.toISOString();

    const logs = permissions.canAccessPanel
      ? await this.prisma.reportEmailRequestLog.findMany({
          where: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            siteId,
            requestDate: currentDateInSiteTz,
            status: { in: ['SENT', 'PENDING'] },
          },
        })
      : [];

    const byKind = new Map(logs.map((l) => [l.reportKind, l]));
    const itemFor = (dbKind: ReportEmailKind): SiteReportDailyQuotaItem => {
      const log = byKind.get(dbKind);
      return {
        requested: Boolean(log),
        sentAt: log?.sentAt
          ? log.sentAt.toISOString()
          : log?.requestedAt
            ? log.requestedAt.toISOString()
            : null,
        targetPeriod: log?.targetPeriod ?? null,
      };
    };

    const rawEmail = actor.email?.trim() ?? '';

    return {
      siteId: site.siteId,
      siteName: site.name,
      timezone: site.timezone,
      currentDateInSiteTz,
      nextAvailableDate,
      nextAvailableAt,
      recipientEmailMasked: rawEmail ? maskEmailAddress(rawEmail) : null,
      hasProPlan,
      permissions,
      requestedToday: {
        dailyAbsencesPdf: itemFor('DAILY_ABSENCES_PDF'),
        monthlyAttendancePdf: itemFor('MONTHLY_ATTENDANCE_PDF'),
        monthlyPayrollExcel: itemFor('MONTHLY_PAYROLL_EXCEL'),
      },
    };
  }

  async requestSiteReportEmail(
    actor: VerifiedActor,
    siteId: string,
    dto: RequestSiteReportEmailDto,
    now: Date = new Date(),
  ): Promise<RequestSiteReportEmailResponse> {
    if (actor.role === 'platform_admin' || !actor.tenantId) {
      throw new ForbiddenException();
    }

    const { dbKind, permKind, label } = mapKindToEnums(dto.kind);

    // 1. Plan gating: Excel monthly payroll remains exclusive to the best plan (PRO).
    if (dto.kind === 'monthly_payroll_excel') {
      const hasPro = await this.hasProPayrollFeature(actor);
      if (!hasPro) {
        throw new FeatureNotInPlanException('payroll_reports');
      }
    }

    // 2. Verify site belongs to actor's tenant.
    await this.snapshots.ensureTenantCatalogSynced(actor.tenantId);
    const site = await this.prisma.siteSnapshot.findFirst({
      where: { tenantId: actor.tenantId, siteId },
    });
    if (!site) {
      throw new SiteNotFoundException();
    }

    // 3. Verify site-level authorization (Owner or site-included user with admin/report permission granted by Owner).
    await this.recipients.authorizeSiteReportEmailRequest(
      actor,
      siteId,
      permKind,
    );

    // 4. Resolve recipient email strictly from verified actor identity (never from client payload).
    const recipientEmail = actor.email?.trim() ?? '';
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new ForbiddenException(
        'No se encontró una dirección de correo verificada para tu usuario',
      );
    }

    // 5. Evaluate calendar day in the site's IANA timezone and validate target date/period.
    const requestDate = formatDateInTz(now, site.timezone);
    const bounds = dayRangeInTz(requestDate, site.timezone);
    const nextAvailableDate = formatDateInTz(
      new Date(bounds.end.getTime() + 60_000),
      site.timezone,
    );
    const nextAvailableAt = bounds.end.toISOString();

    let targetPeriod: string;
    if (dto.kind === 'daily_absences_pdf') {
      targetPeriod = dto.date ?? requestDate;
      if (!isCalendarDate(targetPeriod)) {
        throw new ValidationException([
          { field: 'date', constraints: ['date must be in YYYY-MM-DD format'] },
        ]);
      }
    } else {
      targetPeriod = dto.period ?? formatYearMonthInTz(now, site.timezone);
      if (!isYearMonth(targetPeriod)) {
        throw new ValidationException([
          {
            field: 'period',
            constraints: ['period must be in YYYY-MM format'],
          },
        ]);
      }
    }

    // 6. Enforce strict 1-request-per-day limit per (tenantId, userId, siteId, reportKind, requestDate).
    const existing = await this.prisma.reportEmailRequestLog.findUnique({
      where: {
        tenantId_userId_siteId_reportKind_requestDate: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          siteId,
          reportKind: dbKind,
          requestDate,
        },
      },
    });

    if (
      existing &&
      (existing.status === 'SENT' || existing.status === 'PENDING')
    ) {
      throw new ReportRequestDailyLimitReachedException(nextAvailableDate);
    }

    let requestLogId: string;
    try {
      if (existing && existing.status === 'FAILED') {
        const updated = await this.prisma.reportEmailRequestLog.update({
          where: { id: existing.id },
          data: {
            status: 'PENDING',
            targetPeriod,
            recipientEmail,
            requestedAt: now,
          },
        });
        requestLogId = updated.id;
      } else {
        const created = await this.prisma.reportEmailRequestLog.create({
          data: {
            tenantId: actor.tenantId,
            siteId,
            userId: actor.userId,
            recipientEmail,
            reportKind: dbKind,
            requestDate,
            targetPeriod,
            status: 'PENDING',
            requestedAt: now,
          },
        });
        requestLogId = created.id;
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ReportRequestDailyLimitReachedException(nextAvailableDate);
      }
      throw error;
    }

    // 7. Generate report file scoped to `siteId` and send it to the actor's email.
    try {
      let attachment: {
        filename: string;
        content: Buffer;
        contentType: string;
      };

      if (dto.kind === 'daily_absences_pdf') {
        const { buffer, filename } = await this.reportsService.exportDailyPdf(
          actor,
          { date: targetPeriod, siteId },
        );
        attachment = {
          filename,
          content: buffer,
          contentType: 'application/pdf',
        };
      } else if (dto.kind === 'monthly_attendance_pdf') {
        const { buffer, filename } = await this.reportsService.exportMonthlyPdf(
          actor,
          { period: targetPeriod, siteId },
        );
        attachment = {
          filename,
          content: buffer,
          contentType: 'application/pdf',
        };
      } else {
        const { buffer, filename } =
          await this.reportsService.exportMonthlyPayrollExcel(actor, {
            period: targetPeriod,
            siteId,
          });
        attachment = {
          filename,
          content: buffer,
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
      }

      const subject = `[TeamWorkFlow] ${label} — Sede ${site.name} (${targetPeriod})`;
      const text = `Hola,\n\nAdjuntamos el ${label} solicitado desde el panel de control de la sede "${site.name}" para el período ${targetPeriod}.\n\nRecordá que este informe puede solicitarse por correo una vez al día.\n\nEquipo TeamWorkFlow`;
      const html = `<p>Hola,</p><p>Adjuntamos el <strong>${label}</strong> solicitado desde el panel de control de la sede <strong>${site.name}</strong> para el período <code>${targetPeriod}</code>.</p><p>Recordá que este informe puede solicitarse por correo una vez al día.</p><p>Equipo TeamWorkFlow</p>`;

      await this.mailService.sendReportEmail({
        to: recipientEmail,
        subject,
        text,
        html,
        attachment,
      });

      await this.prisma.reportEmailRequestLog.update({
        where: { id: requestLogId },
        data: {
          status: 'SENT',
          sentAt: now,
        },
      });
    } catch (error) {
      await this.prisma.reportEmailRequestLog
        .update({
          where: { id: requestLogId },
          data: { status: 'FAILED' },
        })
        .catch(() => undefined);
      throw error;
    }

    await this.jetstream
      .publish(actor.tenantId, REPORTS_EVENTS.REPORT_EMAIL_SENT, {
        requestId: requestLogId,
        siteId,
        siteName: site.name,
        kind: dto.kind,
        targetPeriod,
        recipientUserIds: [actor.userId],
      })
      .catch(() => undefined);

    return {
      requestId: requestLogId,
      siteId,
      siteName: site.name,
      kind: dto.kind,
      targetPeriod,
      requestDate,
      sentAt: now.toISOString(),
      sentToEmailMasked: maskEmailAddress(recipientEmail),
      nextAvailableDate,
      nextAvailableAt,
    };
  }
}
