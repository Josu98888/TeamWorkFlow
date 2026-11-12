export type DeadlineMode = 'AFTER_START' | 'AT_SHIFT_END';

export interface CalculateDeadlineOptions {
  shiftStart: Date;
  shiftEnd: Date;
  deadlineMode: DeadlineMode;
  deadlineMinutes?: number | null;
}

export function calculateTaskDeadline({
  shiftStart,
  shiftEnd,
  deadlineMode,
  deadlineMinutes,
}: CalculateDeadlineOptions): Date {
  if (deadlineMode === 'AFTER_START') {
    const minutes = deadlineMinutes ?? 0;
    return new Date(shiftStart.getTime() + minutes * 60_000);
  }

  return new Date(shiftEnd.getTime());
}
