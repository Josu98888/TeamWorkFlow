export const CLOCK_INS_OPERATIONS = {
  CREATE: 'attendance.clock-event.create',
  CREATE_MANUAL: 'attendance.clock-event.create-manual',
  CORRECT: 'attendance.clock-event.correct',
  LIST: 'attendance.clock-event.list',
} as const;

export const CLOCK_INS_EVENTS = {
  RECORDED: 'clock_event_recorded',
  CORRECTED: 'clock_event_corrected',
} as const;
