export const ALERTS_EVENTS = {
  OPENED: 'alert_opened',
  ACKNOWLEDGED: 'alert_acknowledged',
  RESOLVED: 'alert_resolved',
} as const;

export const ALERT_THRESHOLDS = {
  LATE_MINUTES: 10,
  UNCOVERED_POST_MINUTES: 15,
  MISSING_CLOCK_OUT_HOURS: 2,
} as const;
