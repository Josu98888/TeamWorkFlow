import {
  ForbiddenException,
  ValidationException,
} from '../common/exceptions';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { ExcelPayrollExporter } from './export/excel-payroll-exporter';
import { PdfReportExporter } from './export/pdf-report-exporter';
import { ReportRecipientsService } from './report-recipients.service';
import { ReportsService } from './reports.service';

describe('ReportRecipientsService & ReportsService', () => {
  const ownerActor: VerifiedActor = {
    userId: 'user-owner',
    tenantId: 'tenant-1',
    role: 'owner',
    employeeId: null,
  };
  const assignedEmployeeActor: VerifiedActor = {
    userId: 'user-emp-1',
    tenantId: 'tenant-1',
    role: 'employee',
    employeeId: 'emp-1',
  };
  const unassignedSupervisorActor: VerifiedActor = {
    userId: 'user-sup',
    tenantId: 'tenant-1',
    role: 'supervisor',
    employeeId: 'emp-sup',
  };

  let mockPrisma: Record<string, any>;
  let mockSnapshots: Record<string, jest.Mock>;
  let mockJetstream: { publish: jest.Mock };
  let recipientsService: ReportRecipientsService;
  let reportsService: ReportsService;

  beforeEach(() => {
    mockPrisma = {
      reportRecipient: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      employeeSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          {
            employeeId: 'emp-1',
            tenantId: 'tenant-1',
            userId: 'user-emp-1',
            firstName: 'Juan',
            lastName: 'Pérez',
            employeeNumber: 'L-1001',
            isActive: true,
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({
          employeeId: 'emp-1',
          tenantId: 'tenant-1',
          userId: 'user-emp-1',
          firstName: 'Juan',
          lastName: 'Pérez',
          employeeNumber: 'L-1001',
          isActive: true,
        }),
      },
      siteSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          {
            siteId: 'site-1',
            tenantId: 'tenant-1',
            name: 'Parripollo 1',
            timezone: 'America/Argentina/Buenos_Aires',
            isActive: true,
          },
        ]),
      },
      postSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          {
            postId: 'post-1',
            tenantId: 'tenant-1',
            siteId: 'site-1',
            name: 'Parrillero',
            isActive: true,
          },
        ]),
      },
      shiftSnapshot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      clockEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      workday: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      alert: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      employeeCompensation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      postOvertimeRate: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockSnapshots = {
      ensureTenantCatalogSynced: jest.fn().mockResolvedValue(undefined),
    };
    mockJetstream = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

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
  });

  it('always allows owner to access reports and manage recipients', async () => {
    await expect(
      recipientsService.authorizeReportAccess(ownerActor, 'daily'),
    ).resolves.toBeUndefined();

    mockPrisma.reportRecipient.upsert.mockResolvedValue({
      id: 'rec-1',
      tenantId: 'tenant-1',
      userId: 'user-emp-1',
      employeeId: 'emp-1',
      receiveDaily: true,
      receiveMonthly: true,
      receivePayrollExcel: false,
      assignedByUserId: 'user-owner',
      updatedAt: new Date(),
    });

    const saved = await recipientsService.upsertRecipient(
      ownerActor,
      'user-emp-1',
      {
        receiveDaily: true,
        receiveMonthly: true,
        receivePayrollExcel: false,
      },
    );
    expect(saved.userId).toBe('user-emp-1');
    expect(saved.employeeName).toBe('Pérez, Juan');
  });

  it('rejects non-owner without an active ReportRecipient assignment with 403', async () => {
    mockPrisma.reportRecipient.findUnique.mockResolvedValue(null);

    await expect(
      recipientsService.authorizeReportAccess(
        unassignedSupervisorActor,
        'daily',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an assigned active employee to access daily report and export PDF', async () => {
    mockPrisma.reportRecipient.findUnique.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-emp-1',
      employeeId: 'emp-1',
      receiveDaily: true,
      receiveMonthly: false,
      receivePayrollExcel: false,
    });

    const daily = await reportsService.getDailyReport(assignedEmployeeActor, {
      date: '2026-04-17',
    });
    expect(daily.reportDate).toBe('2026-04-17');

    const pdf = await reportsService.exportDailyPdf(assignedEmployeeActor, {
      date: '2026-04-17',
    });
    expect(pdf.filename).toBe('informe-diario-2026-04-17.pdf');
    expect(pdf.buffer.subarray(0, 8).toString('latin1')).toContain('%PDF-1.4');
  });

  it('validates date and period formats on getDailyReport and getMonthlyReport', async () => {
    await expect(
      reportsService.getDailyReport(ownerActor, { date: '2026-99-99' }),
    ).rejects.toBeInstanceOf(ValidationException);

    await expect(
      reportsService.getMonthlyReport(ownerActor, { period: '2026-13' }),
    ).rejects.toBeInstanceOf(ValidationException);
  });
});
