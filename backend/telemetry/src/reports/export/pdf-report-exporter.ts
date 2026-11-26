import { Injectable } from '@nestjs/common';
import type { DailyAttendanceReportPayload } from '../domain/daily-report-builder';
import type { MonthlyAttendanceReportPayload } from '../domain/monthly-report-builder';

const PAGE_HEIGHT = 842; // A4 points
const MARGIN_LEFT = 40;
const TOP_START = 790;
const BOTTOM_LIMIT = 55;
const LINE_HEIGHT = 15;

interface PdfLine {
  text: string;
  bold?: boolean;
  size?: number;
}

function toWinAnsiLiteral(text: string): string {
  const safe = text.replace(/[\r\n\t]+/g, ' ').slice(0, 130);
  let out = '';
  for (let i = 0; i < safe.length; i++) {
    const code = safe.charCodeAt(i);
    const ch = safe[i];
    if (ch === '(' || ch === ')' || ch === '\\') {
      out += `\\${ch}`;
    } else if (code >= 32 && code <= 126) {
      out += ch;
    } else if (code >= 160 && code <= 255) {
      out += `\\${code.toString(8).padStart(3, '0')}`;
    } else {
      out += '?';
    }
  }
  return `(${out})`;
}

function padCell(value: string, width: number): string {
  const clean = value.trim();
  return clean.length >= width
    ? `${clean.slice(0, Math.max(1, width - 1))} `
    : clean.padEnd(width, ' ');
}

function formatMinutesAsHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function buildPdfDocument(lines: PdfLine[]): Buffer {
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let y = TOP_START;

  for (const line of lines) {
    const step = (line.size ?? 10) + 5;
    if (y - step < BOTTOM_LIMIT && current.length > 0) {
      pages.push(current);
      current = [];
      y = TOP_START;
    }
    current.push(line);
    y -= step;
  }
  if (current.length > 0 || pages.length === 0) {
    pages.push(current);
  }

  // Object numbering:
  // 1: Catalog, 2: Pages, 3: Font Regular (/F1), 4: Font Bold (/F2)
  // For each page i (0..N-1): pageObj = 5 + i*2, contentObj = 6 + i*2
  const objects: string[] = [];
  const pageObjIds = pages.map((_, idx) => 5 + idx * 2);

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  for (let i = 0; i < pages.length; i++) {
    const pageLines = pages[i];
    const pageObjId = 5 + i * 2;
    const contentObjId = pageObjId + 1;

    let cursorY = TOP_START;
    const ops: string[] = ['BT'];
    for (const line of pageLines) {
      const size = line.size ?? 9;
      const font = line.bold ? '/F2' : '/F1';
      ops.push(`${font} ${size} Tf`);
      ops.push(`1 0 0 1 ${MARGIN_LEFT} ${cursorY} Tm`);
      ops.push(`${toWinAnsiLiteral(line.text)} Tj`);
      cursorY -= Math.max(LINE_HEIGHT, size + 5);
    }
    ops.push(
      `/F1 8 Tf 1 0 0 1 ${MARGIN_LEFT} 30 Tm ${toWinAnsiLiteral(`Pagina ${i + 1} de ${pages.length} - TeamWorkFlow Attendance`)} Tj`,
    );
    ops.push('ET');
    const streamBody = ops.join('\n');
    const streamBytes = Buffer.byteLength(streamBody, 'latin1');

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`,
    );
    objects.push(`<< /Length ${streamBytes} >>\nstream\n${streamBody}\nendstream`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

@Injectable()
export class PdfReportExporter {
  generateDailyPdf(report: DailyAttendanceReportPayload): Buffer {
    const lines: PdfLine[] = [
      {
        text: `INFORME DIARIO DE ASISTENCIA Y GEOCERCA (${report.reportDate})`,
        bold: true,
        size: 14,
      },
      {
        text: `Generado: ${report.generatedAt} | Filtro Sede: ${report.siteId ?? 'Todas las sedes'}`,
        size: 9,
      },
      { text: ' ', size: 8 },
      { text: '1. RESUMEN DE LA JORNADA', bold: true, size: 11 },
      {
        text: `Turnos asignados: ${report.summary.totalAssignedShifts} | Presentes: ${report.summary.attendedShifts} | Ausentes: ${report.summary.absentCount} | Fuera de geocerca: ${report.summary.outOfGeofenceCount} | Salidas sin fichar: ${report.summary.missingClockOutCount}`,
        size: 9,
      },
      { text: ' ', size: 8 },
      {
        text: '2. TRABAJADORES AUSENTES EN LA JORNADA',
        bold: true,
        size: 11,
      },
    ];

    if (report.absences.length === 0) {
      lines.push({
        text: 'Sin trabajadores ausentes registrados en la jornada.',
        size: 9,
      });
    } else {
      lines.push({
        text: `${padCell('Legajo', 10)}${padCell('Trabajador', 26)}${padCell('Sede', 18)}${padCell('Puesto', 18)}${padCell('Horario', 16)}Estado`,
        bold: true,
        size: 9,
      });
      for (const item of report.absences) {
        const estado =
          item.absenceStatus === 'CONFIRMED_ABSENCE'
            ? 'Ausente confirmado'
            : 'Sin entrada (+15m)';
        lines.push({
          text: `${padCell(item.employeeNumber ?? '-', 10)}${padCell(item.employeeName, 26)}${padCell(item.siteName, 18)}${padCell(item.postName, 18)}${padCell(item.scheduledWindow, 16)}${estado}`,
          size: 8,
        });
      }
    }

    lines.push({ text: ' ', size: 8 });
    lines.push({
      text: '3. FICHAJES FUERA DE LA GEOCERCA (REGISTROS FRAUDULENTOS)',
      bold: true,
      size: 11,
    });

    if (report.outOfGeofenceEvents.length === 0) {
      lines.push({
        text: 'Sin fichajes fuera de geocerca en la jornada.',
        size: 9,
      });
    } else {
      lines.push({
        text: `${padCell('Hora', 8)}${padCell('Legajo', 10)}${padCell('Trabajador', 24)}${padCell('Sede', 16)}${padCell('Puesto', 16)}${padCell('Tipo', 10)}${padCell('Distancia', 11)}Alerta`,
        bold: true,
        size: 9,
      });
      for (const evt of report.outOfGeofenceEvents) {
        const dist =
          evt.distanceMeters !== null ? `${evt.distanceMeters} m` : 'N/A';
        lines.push({
          text: `${padCell(evt.localTime, 8)}${padCell(evt.employeeNumber ?? '-', 10)}${padCell(evt.employeeName, 24)}${padCell(evt.siteName, 16)}${padCell(evt.postName, 16)}${padCell(evt.type, 10)}${padCell(dist, 11)}${evt.alertStatus ?? 'SIN_ALERTA'}`,
          size: 8,
        });
      }
    }

    return buildPdfDocument(lines);
  }

  generateMonthlyPdf(report: MonthlyAttendanceReportPayload): Buffer {
    const lines: PdfLine[] = [
      {
        text: `INFORME MENSUAL DE ASISTENCIA, AUSENCIAS Y GEOCERCA (${report.period})`,
        bold: true,
        size: 14,
      },
      {
        text: `Generado: ${report.generatedAt} | Filtro Sede: ${report.siteId ?? 'Todas las sedes'}`,
        size: 9,
      },
      { text: ' ', size: 8 },
      { text: '1. RESUMEN MENSUAL', bold: true, size: 11 },
      {
        text: `Trabajadores: ${report.summary.employeesCount} | Asistencias: ${report.summary.totalAttendedShifts} | Ausencias: ${report.summary.totalAbsentShifts} | Fuera de geocerca: ${report.summary.totalOutOfGeofence} | Horas trabajadas: ${formatMinutesAsHours(report.summary.totalWorkedMinutes)} | Horas extras: ${formatMinutesAsHours(report.summary.totalOvertimeMinutes)}`,
        size: 9,
      },
      { text: ' ', size: 8 },
      {
        text: '2. CONSOLIDADO POR TRABAJADOR',
        bold: true,
        size: 11,
      },
    ];

    if (report.employees.length === 0) {
      lines.push({
        text: 'Sin actividad registrada en el periodo seleccionado.',
        size: 9,
      });
    } else {
      lines.push({
        text: `${padCell('Legajo', 9)}${padCell('Trabajador', 24)}${padCell('Asist.', 8)}${padCell('Ausen.', 8)}${padCell('Tarde', 8)}${padCell('Fraud.', 8)}${padCell('H. Reg.', 11)}${padCell('H. Extra', 11)}Sal. Falt.`,
        bold: true,
        size: 9,
      });
      for (const emp of report.employees) {
        lines.push({
          text: `${padCell(emp.employeeNumber ?? '-', 9)}${padCell(emp.fullName, 24)}${padCell(String(emp.attendedShifts), 8)}${padCell(String(emp.absentCount), 8)}${padCell(String(emp.lateArrivalsCount), 8)}${padCell(String(emp.outOfGeofenceCount), 8)}${padCell(formatMinutesAsHours(emp.totalRegularMinutes), 11)}${padCell(formatMinutesAsHours(emp.totalOvertimeMinutes), 11)}${emp.missingClockOutCount}`,
          size: 8,
        });
      }
    }

    if (report.outOfGeofenceEvents.length > 0) {
      lines.push({ text: ' ', size: 8 });
      lines.push({
        text: '3. DETALLE DE FICHAJES FRAUDULENTOS (FUERA DE GEOCERCA)',
        bold: true,
        size: 11,
      });
      for (const evt of report.outOfGeofenceEvents) {
        const dist =
          evt.distanceMeters !== null ? `${evt.distanceMeters} m` : 'N/A';
        lines.push({
          text: `${evt.localTime} | ${evt.employeeName} (${evt.employeeNumber ?? '-'}) | ${evt.siteName} - ${evt.postName} | ${evt.type} | Dist: ${dist}`,
          size: 8,
        });
      }
    }

    return buildPdfDocument(lines);
  }
}
