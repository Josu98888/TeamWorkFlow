// Wall-clock helpers in an IANA timezone, built on Intl only (no dependency).
// Instants are stored in UTC; "day" and "week" boundaries are site wall clock.

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function localParts(instantMs: number, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instantMs)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

// Offset of the zone from UTC at `instantMs` (positive east of UTC).
function offsetMs(instantMs: number, timeZone: string): number {
  const p = localParts(instantMs, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

// The UTC instant of 00:00 wall clock on (year, month, day) in `timeZone`.
// `day` may overflow the month (Date.UTC normalizes it). Re-checks the offset
// once so a DST change between the guess and the result is honored.
function zonedMidnight(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = offsetMs(guess, timeZone);
  let result = guess - first;
  const second = offsetMs(result, timeZone);
  if (second !== first) result = guess - second;
  return new Date(result);
}

export interface TimeRange {
  start: Date;
  end: Date;
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// True for a real calendar date written as YYYY-MM-DD.
export function isCalendarDay(value: string): boolean {
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// [00:00, next 00:00) of the wall-clock `day` (YYYY-MM-DD) in `timeZone`.
export function dayRange(day: string, timeZone: string): TimeRange {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return {
    start: zonedMidnight(year, month, dayOfMonth, timeZone),
    end: zonedMidnight(year, month, dayOfMonth + 1, timeZone),
  };
}

// The Monday-to-Sunday wall-clock week of `instant` in `timeZone`.
export function weekRange(instant: Date, timeZone: string): TimeRange {
  const p = localParts(instant.getTime(), timeZone);
  const mondayOffset =
    (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
  return {
    start: zonedMidnight(p.year, p.month, p.day - mondayOffset, timeZone),
    end: zonedMidnight(p.year, p.month, p.day - mondayOffset + 7, timeZone),
  };
}
