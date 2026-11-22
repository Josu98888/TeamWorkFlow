const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface UtcRange {
  start: Date;
  end: Date;
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function isYearMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = MONTH_RE.exec(value);
  if (!match) return false;
  const m = Number(match[2]);
  return m >= 1 && m <= 12;
}

function getZonedParts(instant: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') {
      map[part.type] = Number(part.value);
    }
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = getZonedParts(instant, timeZone);
  const localAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const actualSec = Math.floor(instant.getTime() / 1000) * 1000;
  return localAsUtc - actualSec;
}

export function zonedMidnightUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const approx = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const firstGuess = new Date(approx - tzOffsetMs(new Date(approx), timeZone));
  return new Date(approx - tzOffsetMs(firstGuess, timeZone));
}

export function dayRangeInTz(dateStr: string, timeZone: string): UtcRange {
  const match = DATE_RE.exec(dateStr);
  if (!match) throw new Error(`Invalid date: ${dateStr}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const start = zonedMidnightUtc(y, m, d, timeZone);
  const nextUtc = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
  const end = zonedMidnightUtc(
    nextUtc.getUTCFullYear(),
    nextUtc.getUTCMonth() + 1,
    nextUtc.getUTCDate(),
    timeZone,
  );
  return { start, end };
}

export function monthRangeInTz(periodStr: string, timeZone: string): UtcRange {
  const match = MONTH_RE.exec(periodStr);
  if (!match) throw new Error(`Invalid period: ${periodStr}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const start = zonedMidnightUtc(y, m, 1, timeZone);
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  const end = zonedMidnightUtc(nextYear, nextMonth, 1, timeZone);
  return { start, end };
}

export function formatDateInTz(instant: Date, timeZone: string): string {
  const p = getZonedParts(instant, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function formatTimeInTz(instant: Date, timeZone: string): string {
  const p = getZonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function formatYearMonthInTz(instant: Date, timeZone: string): string {
  const p = getZonedParts(instant, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}`;
}

export function previousDayInTz(now: Date, timeZone: string): string {
  const p = getZonedParts(now, timeZone);
  const prev = new Date(Date.UTC(p.year, p.month - 1, p.day) - DAY_MS);
  return `${String(prev.getUTCFullYear()).padStart(4, '0')}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
}

export function previousYearMonthInTz(now: Date, timeZone: string): string {
  const p = getZonedParts(now, timeZone);
  const prevYear = p.month === 1 ? p.year - 1 : p.year;
  const prevMonth = p.month === 1 ? 12 : p.month - 1;
  return `${String(prevYear).padStart(4, '0')}-${String(prevMonth).padStart(2, '0')}`;
}
