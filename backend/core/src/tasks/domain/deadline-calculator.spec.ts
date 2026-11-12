import { calculateTaskDeadline } from './deadline-calculator';

describe('deadline-calculator', () => {
  const shiftStart = new Date('2026-11-12T08:00:00.000Z');
  const shiftEnd = new Date('2026-11-12T16:00:00.000Z');

  it('calculates deadline after shift start', () => {
    const deadline = calculateTaskDeadline({
      shiftStart,
      shiftEnd,
      deadlineMode: 'AFTER_START',
      deadlineMinutes: 90,
    });

    expect(deadline.toISOString()).toBe('2026-11-12T09:30:00.000Z');
  });

  it('calculates deadline at shift end', () => {
    const deadline = calculateTaskDeadline({
      shiftStart,
      shiftEnd,
      deadlineMode: 'AT_SHIFT_END',
    });

    expect(deadline.toISOString()).toBe('2026-11-12T16:00:00.000Z');
  });
});
