import {
  addCalendarDays,
  isoWeekday,
  isWallClockTime,
  localCalendarDay,
  templateShiftWindow,
  zonedWallClockInstant,
} from './template-schedule';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires'; // UTC-3
const NEW_YORK = 'America/New_York';

describe('template-schedule', () => {
  it('validates 24-hour HH:mm wall-clock strings', () => {
    expect(isWallClockTime('08:00')).toBe(true);
    expect(isWallClockTime('23:59')).toBe(true);
    expect(isWallClockTime('00:00')).toBe(true);
    expect(isWallClockTime('24:00')).toBe(false);
    expect(isWallClockTime('8:00')).toBe(false);
    expect(isWallClockTime('12:60')).toBe(false);
  });

  it('maps instants to the local calendar day of the site timezone', () => {
    // 01:30Z on March 11 is still 22:30 of March 10 in Buenos Aires.
    expect(
      localCalendarDay(new Date('2026-03-11T01:30:00.000Z'), BUENOS_AIRES),
    ).toBe('2026-03-10');
    expect(
      localCalendarDay(new Date('2026-03-11T03:00:00.000Z'), BUENOS_AIRES),
    ).toBe('2026-03-11');
  });

  it('adds calendar days across month and leap-year boundaries', () => {
    expect(addCalendarDays('2026-03-30', 3)).toBe('2026-04-02');
    expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('computes ISO weekdays 1=Monday .. 7=Sunday', () => {
    expect(isoWeekday('2026-03-09')).toBe(1);
    expect(isoWeekday('2026-03-15')).toBe(7);
  });

  it('resolves wall-clock instants in site timezone across DST changes', () => {
    expect(
      zonedWallClockInstant('2026-03-10', '08:00', BUENOS_AIRES).toISOString(),
    ).toBe('2026-03-10T11:00:00.000Z');

    // Before New York DST spring-forward (UTC-5) vs same day morning after (UTC-4).
    expect(
      zonedWallClockInstant('2026-03-08', '01:30', NEW_YORK).toISOString(),
    ).toBe('2026-03-08T06:30:00.000Z');
    expect(
      zonedWallClockInstant('2026-03-08', '08:00', NEW_YORK).toISOString(),
    ).toBe('2026-03-08T12:00:00.000Z');
  });

  it('computes overnight shift windows using exact durationMinutes', () => {
    const window = templateShiftWindow('2026-03-10', '22:00', 480, BUENOS_AIRES);
    expect(window.startsAt.toISOString()).toBe('2026-03-11T01:00:00.000Z');
    expect(window.endsAt.toISOString()).toBe('2026-03-11T09:00:00.000Z');
  });
});
