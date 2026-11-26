const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const zonedPartsCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedPartsCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    zonedPartsCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedDateParts(instant: Date, timeZone: string) {
  const parts = getFormatter(timeZone).formatToParts(instant);
  const map: Record<string, number> = {};
  for (const part of parts) {
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

// Offset `localAsUtcMs - actualUtcMs` for the instant in `timeZone`.
function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedDateParts(instant, timeZone);
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

/**
 * Validates strictly formatted 24h wall-clock `HH:mm` strings.
 */
export function isWallClockTime(value: unknown): value is string {
  return typeof value === 'string' && HHMM_RE.test(value);
}

/**
 * Formats an instant as `YYYY-MM-DD` in the given IANA timezone.
 */
export function localCalendarDay(instant: Date, timeZone: string): string {
  const p = zonedDateParts(instant, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Adds calendar days to a `YYYY-MM-DD` string using pure UTC calendar math.
 */
export function addCalendarDays(day: string, deltaDays: number): string {
  const match = CALENDAR_DAY_RE.exec(day);
  if (!match) {
    throw new Error(`Invalid calendar day: ${day}`);
  }
  const base = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  const target = new Date(base + deltaDays * DAY_MS);
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, '0');
  const d = String(target.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns ISO weekday `1` (Monday) .. `7` (Sunday) for a `YYYY-MM-DD` string.
 */
export function isoWeekday(day: string): number {
  const match = CALENDAR_DAY_RE.exec(day);
  if (!match) {
    throw new Error(`Invalid calendar day: ${day}`);
  }
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  const utcDay = date.getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

/**
 * Resolves a local `YYYY-MM-DD` + `HH:mm` wall-clock time in `timeZone` to a UTC Date.
 */
export function zonedWallClockInstant(
  day: string,
  startTime: string,
  timeZone: string,
): Date {
  const dayMatch = CALENDAR_DAY_RE.exec(day);
  const timeMatch = HHMM_RE.exec(startTime);
  if (!dayMatch || !timeMatch) {
    throw new Error(`Invalid day or wall-clock time: ${day} ${startTime}`);
  }
  const approxUtc = Date.UTC(
    Number(dayMatch[1]),
    Number(dayMatch[2]) - 1,
    Number(dayMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  );
  const firstGuess = new Date(
    approxUtc - tzOffsetMs(new Date(approxUtc), timeZone),
  );
  return new Date(approxUtc - tzOffsetMs(firstGuess, timeZone));
}

/**
 * Builds `[startsAt, endsAt]` for one template occurrence on `day` in `timeZone`.
 */
export function templateShiftWindow(
  day: string,
  startTime: string,
  durationMinutes: number,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const startsAt = zonedWallClockInstant(day, startTime, timeZone);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  return { startsAt, endsAt };
}
