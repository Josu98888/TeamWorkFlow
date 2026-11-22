import ExcelJS from 'exceljs';

import { Prisma } from '../prisma/generated/client';
import { buildDailyReportPayload } from './domain/daily-report-builder';
import { buildMonthlyAttendanceReport } from './domain/monthly-report-builder';
import { calculateMonthlyPayroll } from './domain/payroll-calculator';
import {
  ExcelPayrollExporter,
  sanitizeExcelCellText,
} from './export/excel-payroll-exporter';
import { PdfReportExporter } from './export/pdf-report-exporter';

describe('Reports domain builders, payroll calculator & exporters', () => {
  const sitesById = new Map([
    [
      'site-1',
      {
        name: 'Parripollo 1',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    ],
  ]);
  const postsById = new Map([['post-1', { name: 'Parrillero' }]]);
  const employeesById = new Map([
    [
      'emp-1',
      {
        firstName: 'Juan',
        lastName: 'Pérez',
        employeeNumber: 'L-1001',
        isActive: true,
      },
    ],
    [
      'emp-2',
      {
        firstName: 'Ana',
        lastName: 'Gómez',
        employeeNumber: 'L-1002',
        isActive: true,
      },
    ],
  ]);

  it('builds DailyAttendanceReportPayload classifying absent workers and out-of-geofence clock events', () => {
    const report = buildDailyReportPayload({
      reportDate: '2026-04-17',
      defaultTz: 'America/Argentina/Buenos_Aires',
      now: new Date('2026-04-17T23:00:00.000Z'),
      shifts: [
        {
          shiftId: 'shift-1',
          siteId: 'site-1',
          postId: 'post-1',
          employeeId: 'emp-1',
          startsAt: new Date('2026-04-17T11:00:00.000Z'),
          endsAt: new Date('2026-04-17T19:00:00.000Z'),
          authorizedOvertimeMinutes: 0,
          status: 'COMPLETED',
        },
        {
          shiftId: 'shift-2',
          siteId: 'site-1',
          postId: 'post-1',
          employeeId: 'emp-2',
          startsAt: new Date('2026-04-17T11:00:00.000Z'),
          endsAt: new Date('2026-04-17T19:00:00.000Z'),
          authorizedOvertimeMinutes: 0,
          status: 'COMPLETED',
        },
      ],
      workdays: [
        {
          shiftId: 'shift-1',
          status: 'CLOSED',
          workedMinutes: 480,
          overtimeMinutes: 0,
          lateMinutes: 0,
        },
      ],
      clockEvents: [
        {
          id: 'evt-1',
          shiftId: 'shift-1',
          siteId: 'site-1',
          employeeId: 'emp-1',
          type: 'IN',
          method: 'GPS',
          deviceTime: new Date('2026-04-17T11:00:00.000Z'),
          distanceMeters: 210.5,
          outOfGeofence: true,
        },
      ],
      alerts: [],
      sitesById,
      postsById,
      employeesById,
    });

    expect(report.summary.totalAssignedShifts).toBe(2);
    expect(report.summary.attendedShifts).toBe(1);
    expect(report.summary.absentCount).toBe(1);
    expect(report.summary.outOfGeofenceCount).toBe(1);
    expect(report.absences[0]?.employeeId).toBe('emp-2');
    expect(report.outOfGeofenceEvents[0]?.clockEventId).toBe('evt-1');
  });

  it('builds MonthlyAttendanceReport and calculates exact Decimal payroll for HOURLY and PER_SHIFT', () => {
    const monthly = buildMonthlyAttendanceReport({
      period: '2026-04',
      defaultTz: 'America/Argentina/Buenos_Aires',
      now: new Date('2026-05-01T12:00:00.000Z'),
      shifts: [
        {
          shiftId: 'shift-1',
          siteId: 'site-1',
          postId: 'post-1',
          employeeId: 'emp-1',
          startsAt: new Date('2026-04-17T11:00:00.000Z'),
          endsAt: new Date('2026-04-17T19:00:00.000Z'),
          authorizedOvertimeMinutes: 120,
          status: 'COMPLETED',
        },
        {
          shiftId: 'shift-2',
          siteId: 'site-1',
          postId: 'post-1',
          employeeId: 'emp-2',
          startsAt: new Date('2026-04-17T11:00:00.000Z'),
          endsAt: new Date('2026-04-17T19:00:00.000Z'),
          authorizedOvertimeMinutes: 60,
          status: 'COMPLETED',
        },
      ],
      workdays: [
        {
          shiftId: 'shift-1',
          status: 'CLOSED',
          workedMinutes: 570,
          overtimeMinutes: 90,
          rawOvertimeMinutes: 90,
          authorizedOvertimeMinutes: 120,
          lateMinutes: 0,
          firstInAt: new Date('2026-04-17T11:00:00.000Z'),
          lastOutAt: new Date('2026-04-17T20:30:00.000Z'),
        },
        {
          shiftId: 'shift-2',
          status: 'CLOSED',
          workedMinutes: 540,
          overtimeMinutes: 60,
          rawOvertimeMinutes: 60,
          authorizedOvertimeMinutes: 60,
          lateMinutes: 0,
          firstInAt: new Date('2026-04-17T11:00:00.000Z'),
          lastOutAt: new Date('2026-04-17T20:00:00.000Z'),
        },
      ],
      clockEvents: [
        {
          id: 'e1',
          shiftId: 'shift-1',
          siteId: 'site-1',
          employeeId: 'emp-1',
          type: 'IN',
          method: 'GPS',
          distanceMeters: 10,
          outOfGeofence: false,
          deviceTime: new Date('2026-04-17T11:00:00.000Z'),
        },
        {
          id: 'e2',
          shiftId: 'shift-2',
          siteId: 'site-1',
          employeeId: 'emp-2',
          type: 'IN',
          method: 'GPS',
          distanceMeters: 10,
          outOfGeofence: false,
          deviceTime: new Date('2026-04-17T11:00:00.000Z'),
        },
      ],
      alerts: [],
      sitesById,
      postsById,
      employeesById,
    });

    const payroll = calculateMonthlyPayroll({
      attendanceReport: monthly,
      employeeRates: new Map([
        [
          'emp-1',
          {
            payType: 'HOURLY',
            baseRate: new Prisma.Decimal('4500.00'),
            currency: 'ARS',
          },
        ],
        [
          'emp-2',
          {
            payType: 'PER_SHIFT',
            baseRate: new Prisma.Decimal('32000.00'),
            currency: 'ARS',
          },
        ],
      ]),
      postOvertimeRates: new Map([
        [
          'post-1',
          {
            overtimeHourlyRate: new Prisma.Decimal('6750.00'),
            currency: 'ARS',
          },
        ],
      ]),
    });

    const juan = payroll.employees.find((e) => e.employeeId === 'emp-1')!;
    // 480 regular min = 8h * 4500 = 36000.00; 90 overtime min = 1.5h * 6750 = 10125.00 -> total 46125.00
    expect(juan.regularPay).toBe('36000.00');
    expect(juan.overtimePay).toBe('10125.00');
    expect(juan.totalPay).toBe('46125.00');

    const ana = payroll.employees.find((e) => e.employeeId === 'emp-2')!;
    // 1 attended shift * 32000 = 32000.00; 60 overtime min = 1h * 6750 = 6750.00 -> total 38750.00
    expect(ana.regularPay).toBe('32000.00');
    expect(ana.overtimePay).toBe('6750.00');
    expect(ana.totalPay).toBe('38750.00');
    expect(payroll.totals.totalPay).toBe('84875.00');
  });

  it('generates valid PDF 1.4 and 3-sheet ExcelJS workbook with formula sanitization', async () => {
    const monthly = buildMonthlyAttendanceReport({
      period: '2026-04',
      defaultTz: 'America/Argentina/Buenos_Aires',
      now: new Date('2026-05-01T12:00:00.000Z'),
      shifts: [],
      workdays: [],
      clockEvents: [],
      alerts: [],
      sitesById,
      postsById,
      employeesById,
    });
    const payroll = calculateMonthlyPayroll({
      attendanceReport: monthly,
      employeeRates: new Map(),
      postOvertimeRates: new Map(),
    });

    const pdfExporter = new PdfReportExporter();
    const pdfBuffer = pdfExporter.generateMonthlyPdf(monthly);
    expect(pdfBuffer.subarray(0, 8).toString('latin1')).toContain('%PDF-1.4');

    expect(sanitizeExcelCellText('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");

    const excelExporter = new ExcelPayrollExporter();
    const xlsxBuffer = await excelExporter.generatePayrollWorkbook(payroll);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxBuffer as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'Liquidación y Asistencia',
      'Detalle por Jornada y Puesto',
      'Incidencias y Fraudulentos',
    ]);
  });
});
