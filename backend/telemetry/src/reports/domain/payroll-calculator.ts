import { Prisma, type PayRateType } from '../../prisma/generated/client';
import type {
  MonthlyAttendanceReportPayload,
  MonthlyEmployeeSummaryItem,
  MonthlyShiftDetailItem,
} from './monthly-report-builder';

const ZERO = new Prisma.Decimal(0);
const SIXTY = new Prisma.Decimal(60);

export interface EmployeeRateConfig {
  payType: PayRateType;
  baseRate: Prisma.Decimal;
  currency: string;
}

export interface PostOvertimeRateConfig {
  overtimeHourlyRate: Prisma.Decimal;
  currency: string;
}

export interface PayrollShiftLineItem extends MonthlyShiftDetailItem {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  payType: PayRateType | null;
  baseRateApplied: string | null;
  postOvertimeRateApplied: string | null;
  regularPay: string;
  overtimePay: string;
  totalShiftPay: string;
  warnings: string[];
}

export interface PayrollEmployeeLineItem extends MonthlyEmployeeSummaryItem {
  payType: PayRateType | null;
  baseRateApplied: string | null;
  regularPay: string;
  overtimePay: string;
  totalPay: string;
  missingEmployeeRate: boolean;
  missingPostOvertimeRate: boolean;
  hasMissingClockOut: boolean;
  observations: string;
}

export interface MonthlyPayrollCalculation {
  period: string;
  siteId: string | null;
  currency: string;
  generatedAt: string;
  totals: {
    employeesCount: number;
    totalRegularPay: string;
    totalOvertimePay: string;
    totalPay: string;
    warningsCount: number;
  };
  employees: PayrollEmployeeLineItem[];
  shiftLines: PayrollShiftLineItem[];
  attendanceReport: MonthlyAttendanceReportPayload;
}

export function calculateMonthlyPayroll(input: {
  attendanceReport: MonthlyAttendanceReportPayload;
  employeeRates: Map<string, EmployeeRateConfig>;
  postOvertimeRates: Map<string, PostOvertimeRateConfig>;
}): MonthlyPayrollCalculation {
  const { attendanceReport, employeeRates, postOvertimeRates } = input;

  let grandRegular = ZERO;
  let grandOvertime = ZERO;
  let warningsCount = 0;

  const employees: PayrollEmployeeLineItem[] = [];
  const shiftLines: PayrollShiftLineItem[] = [];

  for (const emp of attendanceReport.employees) {
    const empRate = employeeRates.get(emp.employeeId);
    const empShifts = attendanceReport.shiftsByEmployee[emp.employeeId] ?? [];

    let empRegular = ZERO;
    let empOvertime = ZERO;
    const missingEmployeeRate = !empRate;
    let missingPostOvertimeRate = false;
    const hasMissingClockOut = emp.missingClockOutCount > 0;

    for (const shift of empShifts) {
      const postRate = postOvertimeRates.get(shift.postId);
      let shiftRegular = ZERO;
      let shiftOvertime = ZERO;
      const shiftWarnings: string[] = [];

      if (shift.workdayStatus === 'CLOSED') {
        if (!empRate) {
          shiftWarnings.push('Sin tarifa base de empleado');
        } else if (empRate.payType === 'HOURLY') {
          shiftRegular = new Prisma.Decimal(shift.regularMinutes)
            .div(SIXTY)
            .mul(empRate.baseRate)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        } else if (empRate.payType === 'PER_SHIFT') {
          if (shift.workedMinutes > 0) {
            shiftRegular = empRate.baseRate.toDecimalPlaces(
              2,
              Prisma.Decimal.ROUND_HALF_UP,
            );
          }
        }

        if (shift.overtimeMinutes > 0) {
          if (!postRate) {
            missingPostOvertimeRate = true;
            shiftWarnings.push('Sin tarifa de hora extra en puesto');
          } else {
            shiftOvertime = new Prisma.Decimal(shift.overtimeMinutes)
              .div(SIXTY)
              .mul(postRate.overtimeHourlyRate)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
          }
        }
      } else if (shift.workdayStatus === 'MISSING_CLOCK_OUT') {
        shiftWarnings.push('Salida sin fichar ($0.00 hasta corrección)');
      }

      const shiftTotal = shiftRegular.add(shiftOvertime);
      empRegular = empRegular.add(shiftRegular);
      empOvertime = empOvertime.add(shiftOvertime);

      shiftLines.push({
        ...shift,
        employeeId: emp.employeeId,
        employeeName: emp.fullName,
        employeeNumber: emp.employeeNumber,
        payType: empRate?.payType ?? null,
        baseRateApplied: empRate ? empRate.baseRate.toFixed(2) : null,
        postOvertimeRateApplied: postRate
          ? postRate.overtimeHourlyRate.toFixed(2)
          : null,
        regularPay: shiftRegular.toFixed(2),
        overtimePay: shiftOvertime.toFixed(2),
        totalShiftPay: shiftTotal.toFixed(2),
        warnings: shiftWarnings,
      });
    }

    const obs: string[] = [];
    if (missingEmployeeRate) {
      obs.push('Falta configurar tarifa del empleado');
    }
    if (missingPostOvertimeRate) {
      obs.push('Falta configurar tarifa de hora extra del puesto');
    }
    if (hasMissingClockOut) {
      obs.push(`${emp.missingClockOutCount} jornada(s) con salida sin fichar`);
    }
    if (emp.outOfGeofenceCount > 0) {
      obs.push(`${emp.outOfGeofenceCount} fichaje(s) fuera de geocerca`);
    }

    if (missingEmployeeRate || missingPostOvertimeRate || hasMissingClockOut) {
      warningsCount++;
    }

    const empTotal = empRegular.add(empOvertime);
    grandRegular = grandRegular.add(empRegular);
    grandOvertime = grandOvertime.add(empOvertime);

    employees.push({
      ...emp,
      payType: empRate?.payType ?? null,
      baseRateApplied: empRate ? empRate.baseRate.toFixed(2) : null,
      regularPay: empRegular.toFixed(2),
      overtimePay: empOvertime.toFixed(2),
      totalPay: empTotal.toFixed(2),
      missingEmployeeRate,
      missingPostOvertimeRate,
      hasMissingClockOut,
      observations: obs.join(' · '),
    });
  }

  const grandTotal = grandRegular.add(grandOvertime);

  return {
    period: attendanceReport.period,
    siteId: attendanceReport.siteId,
    currency: 'ARS',
    generatedAt: attendanceReport.generatedAt,
    totals: {
      employeesCount: employees.length,
      totalRegularPay: grandRegular.toFixed(2),
      totalOvertimePay: grandOvertime.toFixed(2),
      totalPay: grandTotal.toFixed(2),
      warningsCount,
    },
    employees,
    shiftLines,
    attendanceReport,
  };
}
