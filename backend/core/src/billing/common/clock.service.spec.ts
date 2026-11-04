import { SystemClockService, TestClockService } from './clock.service';

describe('clock.service', () => {
  it('SystemClockService returns current date', () => {
    const clock = new SystemClockService();
    const before = Date.now();
    const now = clock.now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('TestClockService allows deterministic time travel', () => {
    const start = new Date('2026-10-01T00:00:00.000Z');
    const clock = new TestClockService(start);

    expect(clock.now().toISOString()).toBe('2026-10-01T00:00:00.000Z');

    clock.advanceByDays(10);
    expect(clock.now().toISOString()).toBe('2026-10-11T00:00:00.000Z');

    clock.advanceByHours(3);
    expect(clock.now().toISOString()).toBe('2026-10-11T03:00:00.000Z');

    clock.advanceByMs(500);
    expect(clock.now().toISOString()).toBe('2026-10-11T03:00:00.500Z');

    clock.setTime('2026-11-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});
