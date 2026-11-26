import {
  FeatureNotInPlanException,
  ForbiddenException,
  MailDeliveryFailedException,
  ReportRequestDailyLimitReachedException,
  SiteNotFoundException,
} from '../common/exceptions';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { ExcelPayrollExporter } from './export/excel-payroll-exporter';
import { PdfReportExporter } from './export/pdf-report-exporter';
import { ReportMailService } from './mail/report-mail.service';
import { ReportRecipientsService } from './report-recipients.service';
import { ReportsService } from './reports.service';
import { SiteReportEmailService } from './site-report-email.service';

jest.mock('../config', () => ({
  envs: {
    defaultReportTz: 'America/Argentina/Buenos_Aires',
    mailEnabled: false,
    mailFrom: 'no-reply@teamworkflow.local',
    mailProvider: 'fake',
  },
}));

describe('SiteReportEmailService', () => {
  const SITE_A = '0199b7e0-0000-7000-8000-0000000000a1';
  const SITE_B = '0199b7e0-0000-7000-8000-0000000000b2';
  const TENANT_1 = '0199b7e0-0000-7000-8000-000000000010';
  const NOW = new Date('2026-11-25T15:00:00.000Z'); // 2026-11-25 12:00 in Buenos Aires

  const ownerProActor: VerifiedActor = {
    userId: 'user-owner',
    tenantId: TENANT_1,
    email: 'owner@empresa.com',
    role: 'owner',
    siteIds: [],
    tenantStatus: 'active',
    plan: 'pro',
    features: { payroll_reports: true, alerts: true, tower: true },
  };

  const ownerBasicActor: VerifiedActor = {
    ...ownerProActor,
    plan: 'basic',
    features: { payroll_reports: false, alerts: false, tower: false },
  };

  const hrSiteAActor: VerifiedActor = {
    userId: 'user-hr-a',
    tenantId: TENANT_1,
    email: 'rrhh.sedea@empresa.com',
    role: 'employee',
    siteIds: [],
    tenantStatus: 'active',
    plan: 'pro',
    features: { payroll_reports: true },
  };

  const siteAdminActor: VerifiedActor = {
    userId: 'user-admin-a',
    tenantId: TENANT_1,
    email: 'admin.sedea@empresa.com',
    role: 'admin',
    siteIds: [],
    tenantStatus: 'active',
    plan: 'pro',
    features: { payroll_reports: true },
  };

  const regularEmployeeActor: VerifiedActor = {
    userId: 'user-regular',
    tenantId: TENANT_1,
    email: 'operario@empresa.com',
    role: 'employee',
    siteIds: [],
    tenantStatus: 'active',
    plan: 'pro',
    features: { payroll_reports: true },
  };

  let logs: Array<{
    id: string;
    tenantId: string;
    siteId: string;
    userId: string;
    recipientEmail: string;
    reportKind: string;
    requestDate: string;
    targetPeriod: string;
    status: 'PENDING' | 'SENT' | 'FAILED';
    requestedAt: Date;
    sentAt: Date | null;
  }>;
  let mockPrisma: Record<string, any>;
  let mockTenantState: { hasFeature: jest.Mock };
  let mailService: ReportMailService;
  let recipientsService: ReportRecipientsService;
  let reportsService: ReportsService;
  let service: SiteReportEmailService;

  beforeEach(() => {
    logs = [];

    const sites = [
      {
        siteId: SITE_A,
        tenantId: TENANT_1,
        name: 'Planta Norte Pilar',
        timezone: 'America/Argentina/Buenos_Aires',
        isActive: true,
      },
      {
        siteId: SITE_B,
        tenantId: TENANT_1,
        name: 'Centro Logístico Zárate',
        timezone: 'America/Argentina/Buenos_Aires',
        isActive: true,
      },
    ];

    const employees = [
      {
        employeeId: 'emp-hr-a',
        tenantId: TENANT_1,
        userId: 'user-hr-a',
        firstName: 'Lucía',
        lastName: 'Fernández',
        employeeNumber: 'L-1001',
        siteIds: [SITE_A],
        isActive: true,
      },
      {
        employeeId: 'emp-admin-a',
        tenantId: TENANT_1,
        userId: 'user-admin-a',
        firstName: 'Carlos',
        lastName: 'Admin',
        employeeNumber: null,
        siteIds: [SITE_A],
        isActive: true,
      },
      {
        employeeId: 'emp-regular',
        tenantId: TENANT_1,
        userId: 'user-regular',
        firstName: 'Pedro',
        lastName: 'Operario',
        employeeNumber: 'L-1009',
        siteIds: [SITE_A],
        isActive: true,
      },
    ];

    const recipients = [
      {
        id: 'rec-hr-a',
        tenantId: TENANT_1,
        userId: 'user-hr-a',
        employeeId: 'emp-hr-a',
        siteIds: [SITE_A],
        receiveDaily: true,
        receiveMonthly: true,
        receivePayrollExcel: true,
        assignedByUserId: 'user-owner',
        updatedAt: NOW,
      },
    ];

    mockPrisma = {
      siteSnapshot: {
        findMany: jest.fn().mockResolvedValue(sites),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { tenantId: string; siteId: string } }) =>
            Promise.resolve(
              sites.find(
                (s) => s.tenantId === where.tenantId && s.siteId === where.siteId,
              ) ?? null,
            ),
          ),
      },
      postSnapshot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      employeeSnapshot: {
        findMany: jest.fn().mockResolvedValue(employees),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { tenantId: string; userId?: string } }) =>
            Promise.resolve(
              employees.find(
                (e) =>
                  e.tenantId === where.tenantId &&
                  (!where.userId || e.userId === where.userId),
              ) ?? null,
            ),
          ),
      },
      reportRecipient: {
        findUnique: jest
          .fn()
          .mockImplementation(
            ({
              where,
            }: {
              where: { tenantId_userId: { tenantId: string; userId: string } };
            }) =>
              Promise.resolve(
                recipients.find(
                  (r) =>
                    r.tenantId === where.tenantId_userId.tenantId &&
                    r.userId === where.tenantId_userId.userId,
                ) ?? null,
              ),
          ),
        findMany: jest.fn().mockResolvedValue(recipients),
      },
      reportEmailRequestLog: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }: { where: Record<string, any> }) =>
            Promise.resolve(
              logs.filter(
                (l) =>
                  l.tenantId === where.tenantId &&
                  l.userId === where.userId &&
                  l.siteId === where.siteId &&
                  l.requestDate === where.requestDate &&
                  where.status.in.includes(l.status),
              ),
            ),
          ),
        findUnique: jest
          .fn()
          .mockImplementation(
            ({
              where,
            }: {
              where: {
                tenantId_userId_siteId_reportKind_requestDate: {
                  tenantId: string;
                  userId: string;
                  siteId: string;
                  reportKind: string;
                  requestDate: string;
                };
              };
            }) => {
              const k = where.tenantId_userId_siteId_reportKind_requestDate;
              return Promise.resolve(
                logs.find(
                  (l) =>
                    l.tenantId === k.tenantId &&
                    l.userId === k.userId &&
                    l.siteId === k.siteId &&
                    l.reportKind === k.reportKind &&
                    l.requestDate === k.requestDate,
                ) ?? null,
              );
            },
          ),
        create: jest.fn().mockImplementation(({ data }: { data: any }) => {
          const dup = logs.find(
            (l) =>
              l.tenantId === data.tenantId &&
              l.userId === data.userId &&
              l.siteId === data.siteId &&
              l.reportKind === data.reportKind &&
              l.requestDate === data.requestDate,
          );
          if (dup) {
            throw Object.assign(new Error('Unique violation'), {
              code: 'P2002',
            });
          }
          const created = {
            id: `log-${logs.length + 1}`,
            ...data,
            sentAt: null,
          };
          logs.push(created);
          return Promise.resolve(created);
        }),
        update: jest
          .fn()
          .mockImplementation(({ where, data }: { where: { id: string }; data: any }) => {
            const found = logs.find((l) => l.id === where.id);
            if (found) Object.assign(found, data);
            return Promise.resolve(found);
          }),
      },
      shiftSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      clockEvent: { findMany: jest.fn().mockResolvedValue([]) },
      workday: { findMany: jest.fn().mockResolvedValue([]) },
      alert: { findMany: jest.fn().mockResolvedValue([]) },
      employeeCompensation: { findMany: jest.fn().mockResolvedValue([]) },
      postOvertimeRate: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const mockSnapshots = {
      ensureTenantCatalogSynced: jest.fn().mockResolvedValue(undefined),
    };
    mockTenantState = {
      hasFeature: jest.fn().mockResolvedValue(true),
    };
    const mockJetstream = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    mailService = new ReportMailService();
    recipientsService = new ReportRecipientsService(
      mockPrisma as never,
      mockSnapshots as never,
    );
    reportsService = new ReportsService(
      mockPrisma as never,
      mockSnapshots as never,
      recipientsService,
      new PdfReportExporter(),
      new ExcelPayrollExporter(),
      mockJetstream as never,
    );
    service = new SiteReportEmailService(
      mockPrisma as never,
      mockSnapshots as never,
      mockTenantState as never,
      recipientsService,
      reportsService,
      mailService,
      mockJetstream as never,
    );
  });

  it('sends the daily absences PDF report to the email of the owner who clicked the button and enforces 1 request per day', async () => {
    const res = await service.requestSiteReportEmail(
      ownerProActor,
      SITE_A,
      { kind: 'daily_absences_pdf' },
      NOW,
    );

    expect(res.siteId).toBe(SITE_A);
    expect(res.kind).toBe('daily_absences_pdf');
    expect(res.requestDate).toBe('2026-11-25');
    expect(res.sentToEmailMasked).toBe('o***@empresa.com');

    const sent = mailService.getSentHistory();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('owner@empresa.com');
    expect(sent[0].attachment.filename).toBe('informe-diario-2026-11-25.pdf');

    // Second request on the same day for the same report & site must be rejected with 429
    await expect(
      service.requestSiteReportEmail(
        ownerProActor,
        SITE_A,
        { kind: 'daily_absences_pdf' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ReportRequestDailyLimitReachedException);

    // Requesting the monthly report on the same day is still allowed (independent 1/day quota per report kind)
    const monthlyRes = await service.requestSiteReportEmail(
      ownerProActor,
      SITE_A,
      { kind: 'monthly_attendance_pdf', period: '2026-11' },
      NOW,
    );
    expect(monthlyRes.kind).toBe('monthly_attendance_pdf');
    expect(mailService.getSentHistory()).toHaveLength(2);

    // On the next calendar day in the site timezone, the daily report can be requested again
    const tomorrow = new Date('2026-11-26T15:00:00.000Z');
    const nextDayRes = await service.requestSiteReportEmail(
      ownerProActor,
      SITE_A,
      { kind: 'daily_absences_pdf' },
      tomorrow,
    );
    expect(nextDayRes.requestDate).toBe('2026-11-26');
  });

  it('allows an HR worker included in Site A with Owner permission to request reports for Site A, but rejects them with 403 on Site B', async () => {
    const resA = await service.requestSiteReportEmail(
      hrSiteAActor,
      SITE_A,
      { kind: 'daily_absences_pdf' },
      NOW,
    );
    expect(resA.sentToEmailMasked).toBe('r***@empresa.com');
    expect(mailService.getSentHistory()[0].to).toBe('rrhh.sedea@empresa.com');

    // Same HR worker trying to request for Site B (where they are NOT included) -> 403 Forbidden
    await expect(
      service.requestSiteReportEmail(
        hrSiteAActor,
        SITE_B,
        { kind: 'daily_absences_pdf' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a site-included admin to request for their included site (Site A), and rejects regular employees without Owner permission', async () => {
    const adminRes = await service.requestSiteReportEmail(
      siteAdminActor,
      SITE_A,
      { kind: 'monthly_attendance_pdf' },
      NOW,
    );
    expect(adminRes.sentToEmailMasked).toBe('a***@empresa.com');

    // Site-included admin on Site B (not included) -> 403
    await expect(
      service.requestSiteReportEmail(
        siteAdminActor,
        SITE_B,
        { kind: 'monthly_attendance_pdf' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Regular employee included in Site A without Owner report admin permission -> 403
    await expect(
      service.requestSiteReportEmail(
        regularEmployeeActor,
        SITE_A,
        { kind: 'daily_absences_pdf' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('restricts monthly Excel payroll email requests to PRO plan tenants (403 feature_not_in_plan on BASIC)', async () => {
    mockTenantState.hasFeature.mockResolvedValue(false);

    // BASIC tenant can still request daily and monthly PDF
    await expect(
      service.requestSiteReportEmail(
        ownerBasicActor,
        SITE_A,
        { kind: 'monthly_attendance_pdf' },
        NOW,
      ),
    ).resolves.toMatchObject({ kind: 'monthly_attendance_pdf' });

    // BASIC tenant requesting monthly Excel payroll -> 403 feature_not_in_plan
    await expect(
      service.requestSiteReportEmail(
        ownerBasicActor,
        SITE_A,
        { kind: 'monthly_payroll_excel' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(FeatureNotInPlanException);

    // PRO tenant requesting monthly Excel payroll -> 201 with .xlsx attachment
    mockTenantState.hasFeature.mockResolvedValue(true);
    const excelRes = await service.requestSiteReportEmail(
      ownerProActor,
      SITE_A,
      { kind: 'monthly_payroll_excel', period: '2026-11' },
      NOW,
    );
    expect(excelRes.kind).toBe('monthly_payroll_excel');
    const lastMail = mailService.getSentHistory().at(-1)!;
    expect(lastMail.attachment.filename).toBe('liquidacion-asistencia-2026-11.xlsx');
  });

  it('releases the daily quota if mail delivery fails so the user can retry', async () => {
    jest
      .spyOn(mailService, 'sendReportEmail')
      .mockRejectedValueOnce(new MailDeliveryFailedException());

    await expect(
      service.requestSiteReportEmail(
        ownerProActor,
        SITE_A,
        { kind: 'daily_absences_pdf' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MailDeliveryFailedException);

    // Retry immediately succeeds because previous attempt was marked FAILED
    const retryRes = await service.requestSiteReportEmail(
      ownerProActor,
      SITE_A,
      { kind: 'daily_absences_pdf' },
      NOW,
    );
    expect(retryRes.kind).toBe('daily_absences_pdf');
  });

  it('returns 404 site_not_found for an unknown or cross-tenant site', async () => {
    await expect(
      service.getSiteEmailRequestStatus(ownerProActor, '0199b7e0-0000-7000-8000-999999999999', NOW),
    ).rejects.toBeInstanceOf(SiteNotFoundException);
  });
});
