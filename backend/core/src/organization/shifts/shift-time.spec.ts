import { dayRange, isCalendarDay, weekRange } from './shift-time';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires'; // UTC-3, no DST
const NEW_YORK = 'America/New_York';

describe('shift-time', () => {
  it('validates calendar days', () => {
    expect(isCalendarDay('2026-02-28')).toBe(true);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('2026-13-01')).toBe(false);
    expect(isCalendarDay('26-01-01')).toBe(false);
  });

  it('reads a day in the site timezone, not in UTC', () => {
    const range = dayRange('2026-03-10', BUENOS_AIRES);
    expect(range.start.toISOString()).toBe('2026-03-10T03:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-03-11T03:00:00.000Z');
  });

  it('keeps a 23-hour day when the clocks go forward', () => {
    const range = dayRange('2026-03-08', NEW_YORK);
    expect(range.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('builds the Monday-to-Sunday week of the site timezone', () => {
    // 2026-03-11 is a Wednesday; 01:00Z is still Tuesday night in Buenos Aires.
    const week = weekRange(new Date('2026-03-11T01:00:00Z'), BUENOS_AIRES);
    expect(week.start.toISOString()).toBe('2026-03-09T03:00:00.000Z');
    expect(week.end.toISOString()).toBe('2026-03-16T03:00:00.000Z');
  });

  it('puts Sunday night in the week that started the previous Monday', () => {
    const week = weekRange(new Date('2026-03-16T01:00:00Z'), BUENOS_AIRES);
    expect(week.start.toISOString()).toBe('2026-03-09T03:00:00.000Z');
  });
});
