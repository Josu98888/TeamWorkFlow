import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { MonthlyPayrollCalculation } from '../domain/payroll-calculator';

const DANGEROUS_FORMULA_PREFIX = /^[=+\-@\t\r]/;
const CURRENCY_FMT = '"$"#,##0.00';
const HOURS_FMT = '0.00';

export function sanitizeExcelCellText(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = String(value);
  return DANGEROUS_FORMULA_PREFIX.test(trimmed) ? `'${trimmed}` : trimmed;
}

function minutesToDecimalHours(minutes: number): number {
  return Number((minutes / 60).toFixed(2));
}

function payTypeLabel(payType: 'HOURLY' | 'PER_SHIFT' | null): string {
  if (payType === 'HOURLY') return 'Por hora';
  if (payType === 'PER_SHIFT') return 'Por jornada';
  return 'Sin configurar';
}

@Injectable()
export class ExcelPayrollExporter {
  async generatePayrollWorkbook(
    payroll: MonthlyPayrollCalculation,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TeamWorkFlow Telemetry';
    workbook.created = new Date(payroll.generatedAt);

    // =========================================================================
    // Sheet 1: Liquidación y Asistencia (Resumen por trabajador)
    // =========================================================================
    const sheet1 = workbook.addWorksheet('Liquidación y Asistencia', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    sheet1.addRow([
      `LIQUIDACIÓN MENSUAL Y ASISTENCIA — PERÍODO ${payroll.period}`,
    ]).font = { bold: true, size: 13 };
    sheet1.addRow([
      `Moneda: ${payroll.currency} | Generado: ${payroll.generatedAt} | Advertencias: ${payroll.totals.warningsCount}`,
    ]).font = { italic: true, size: 10 };
    sheet1.addRow([]);

    const headers1 = [
      'Legajo',
      'Trabajador',
      'Estado',
      'Modalidad de Pago',
      'Tarifa Base (ARS)',
      'Turnos Asignados',
      'Asistencias',
      'Ausencias',
      'Salidas Faltantes',
      'Llegadas Tarde',
      'Min. Tardanza',
      'Fichajes Fraudulentos (Fuera Geocerca)',
      'Horas Regulares',
      'Horas Extras Asignadas (h)',
      'Horas Extras Liquidadas (h)',
      'Total Horas Liquidadas',
      'Paga Base (ARS)',
      'Paga Horas Extras (ARS)',
      'Total a Pagar (ARS)',
      'Observaciones',
    ];
    const headerRow1 = sheet1.addRow(headers1);
    headerRow1.font = { bold: true };

    for (const emp of payroll.employees) {
      const regHours = minutesToDecimalHours(emp.totalRegularMinutes);
      const authOtHours = minutesToDecimalHours(
        emp.totalAuthorizedOvertimeMinutes,
      );
      const paidOtHours = minutesToDecimalHours(emp.totalOvertimeMinutes);
      const totalPaidHours = Number((regHours + paidOtHours).toFixed(2));

      const row = sheet1.addRow([
        sanitizeExcelCellText(emp.employeeNumber ?? '—'),
        sanitizeExcelCellText(emp.fullName),
        emp.isActive ? 'Activo' : 'Inactivo',
        payTypeLabel(emp.payType),
        emp.baseRateApplied !== null ? Number(emp.baseRateApplied) : 0,
        emp.totalAssignedShifts,
        emp.attendedShifts,
        emp.absentCount,
        emp.missingClockOutCount,
        emp.lateArrivalsCount,
        emp.totalLateMinutes,
        emp.outOfGeofenceCount,
        regHours,
        authOtHours,
        paidOtHours,
        totalPaidHours,
        Number(emp.regularPay),
        Number(emp.overtimePay),
        Number(emp.totalPay),
        sanitizeExcelCellText(emp.observations),
      ]);

      row.getCell(5).numFmt = CURRENCY_FMT;
      row.getCell(13).numFmt = HOURS_FMT;
      row.getCell(14).numFmt = HOURS_FMT;
      row.getCell(15).numFmt = HOURS_FMT;
      row.getCell(16).numFmt = HOURS_FMT;
      row.getCell(17).numFmt = CURRENCY_FMT;
      row.getCell(18).numFmt = CURRENCY_FMT;
      row.getCell(19).numFmt = CURRENCY_FMT;
      row.getCell(19).font = { bold: true };
    }

    const totalRow1 = sheet1.addRow([
      '',
      'TOTALES DEL PERÍODO',
      '',
      '',
      '',
      payroll.attendanceReport.summary.totalAssignedShifts,
      payroll.attendanceReport.summary.totalAttendedShifts,
      payroll.attendanceReport.summary.totalAbsentShifts,
      payroll.attendanceReport.summary.totalMissingClockOuts,
      payroll.employees.reduce((s, e) => s + e.lateArrivalsCount, 0),
      payroll.employees.reduce((s, e) => s + e.totalLateMinutes, 0),
      payroll.attendanceReport.summary.totalOutOfGeofence,
      minutesToDecimalHours(
        payroll.attendanceReport.summary.totalRegularMinutes,
      ),
      minutesToDecimalHours(
        payroll.employees.reduce(
          (s, e) => s + e.totalAuthorizedOvertimeMinutes,
          0,
        ),
      ),
      minutesToDecimalHours(
        payroll.attendanceReport.summary.totalOvertimeMinutes,
      ),
      minutesToDecimalHours(
        payroll.attendanceReport.summary.totalRegularMinutes +
          payroll.attendanceReport.summary.totalOvertimeMinutes,
      ),
      Number(payroll.totals.totalRegularPay),
      Number(payroll.totals.totalOvertimePay),
      Number(payroll.totals.totalPay),
      '',
    ]);
    totalRow1.font = { bold: true };
    totalRow1.getCell(17).numFmt = CURRENCY_FMT;
    totalRow1.getCell(18).numFmt = CURRENCY_FMT;
    totalRow1.getCell(19).numFmt = CURRENCY_FMT;

    // =========================================================================
    // Sheet 2: Detalle por Jornada y Puesto
    // =========================================================================
    const sheet2 = workbook.addWorksheet('Detalle por Jornada y Puesto', {
      views: [{ state: 'frozen', ySplit: 2 }],
    });

    sheet2.addRow([
      `DETALLE POR JORNADA Y PUESTO — PERÍODO ${payroll.period}`,
    ]).font = { bold: true, size: 12 };

    const headers2 = [
      'Legajo',
      'Trabajador',
      'Fecha',
      'Sede',
      'Puesto',
      'Horario Programado',
      'Entrada Real',
      'Salida Real',
      'Estado Jornada',
      'Min. Tardanza',
      'Fuera de Geocerca',
      'Horas Regulares (h)',
      'Horas Extras Asignadas (h)',
      'Horas Extras Trabajadas (h)',
      'Horas Extras Liquidadas (h)',
      'Tarifa Base Aplicada',
      'Tarifa Hora Extra Puesto',
      'Paga Base (ARS)',
      'Paga Extras (ARS)',
      'Total Jornada (ARS)',
    ];
    sheet2.addRow(headers2).font = { bold: true };

    for (const line of payroll.shiftLines) {
      const row = sheet2.addRow([
        sanitizeExcelCellText(line.employeeNumber ?? '—'),
        sanitizeExcelCellText(line.employeeName),
        line.date,
        sanitizeExcelCellText(line.siteName),
        sanitizeExcelCellText(line.postName),
        line.scheduledWindow,
        line.firstInAt ?? '—',
        line.lastOutAt ?? '—',
        line.workdayStatus,
        line.lateMinutes,
        line.outOfGeofenceCount > 0 ? `Sí (${line.outOfGeofenceCount})` : 'No',
        minutesToDecimalHours(line.regularMinutes),
        minutesToDecimalHours(line.authorizedOvertimeMinutes),
        minutesToDecimalHours(line.rawOvertimeMinutes),
        minutesToDecimalHours(line.overtimeMinutes),
        line.baseRateApplied !== null ? Number(line.baseRateApplied) : 0,
        line.postOvertimeRateApplied !== null
          ? Number(line.postOvertimeRateApplied)
          : 0,
        Number(line.regularPay),
        Number(line.overtimePay),
        Number(line.totalShiftPay),
      ]);
      row.getCell(16).numFmt = CURRENCY_FMT;
      row.getCell(17).numFmt = CURRENCY_FMT;
      row.getCell(18).numFmt = CURRENCY_FMT;
      row.getCell(19).numFmt = CURRENCY_FMT;
      row.getCell(20).numFmt = CURRENCY_FMT;
    }

    // =========================================================================
    // Sheet 3: Incidencias y Fraudulentos
    // =========================================================================
    const sheet3 = workbook.addWorksheet('Incidencias y Fraudulentos');
    sheet3.addRow(['SECCIÓN A — FICHAJES FRAUDULENTOS (FUERA DE GEOCERCA)']).font =
      { bold: true, size: 12 };
    sheet3.addRow([
      'Fecha y Hora',
      'Legajo',
      'Trabajador',
      'Sede',
      'Puesto',
      'Tipo Fichada',
      'Método',
      'Distancia (m)',
      'Estado Alerta',
    ]).font = { bold: true };

    for (const evt of payroll.attendanceReport.outOfGeofenceEvents) {
      sheet3.addRow([
        evt.localTime,
        sanitizeExcelCellText(evt.employeeNumber ?? '—'),
        sanitizeExcelCellText(evt.employeeName),
        sanitizeExcelCellText(evt.siteName),
        sanitizeExcelCellText(evt.postName),
        evt.type,
        evt.method,
        evt.distanceMeters ?? 0,
        evt.alertStatus ?? 'SIN_ALERTA',
      ]);
    }

    sheet3.addRow([]);
    sheet3.addRow(['SECCIÓN B — AUSENCIAS CONFIRMADAS DEL PERÍODO']).font = {
      bold: true,
      size: 12,
    };
    sheet3.addRow([
      'Fecha Turno',
      'Sede',
      'Puesto',
      'Horario',
      'Legajo',
      'Trabajador',
      'Estado',
    ]).font = { bold: true };

    for (const abs of payroll.attendanceReport.absences) {
      sheet3.addRow([
        abs.startsAt.slice(0, 10),
        sanitizeExcelCellText(abs.siteName),
        sanitizeExcelCellText(abs.postName),
        abs.scheduledWindow,
        sanitizeExcelCellText(abs.employeeNumber ?? '—'),
        sanitizeExcelCellText(abs.employeeName),
        abs.absenceStatus,
      ]);
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}
