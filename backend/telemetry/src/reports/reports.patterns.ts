export const REPORTS_PATTERNS = {
  RECIPIENTS_LIST: 'attendance.report.recipients.list',
  RECIPIENTS_UPSERT: 'attendance.report.recipients.upsert',
  RECIPIENTS_REMOVE: 'attendance.report.recipients.remove',
  DAILY_GET: 'attendance.report.daily.get',
  DAILY_PDF: 'attendance.report.daily.pdf',
  DAILY_HISTORY: 'attendance.report.daily.history',
  MONTHLY_GET: 'attendance.report.monthly.get',
  MONTHLY_PDF: 'attendance.report.monthly.pdf',
  MONTHLY_EMPLOYEE_DETAIL: 'attendance.report.monthly.employee-detail',
  MONTHLY_HISTORY: 'attendance.report.monthly.history',
  PAYROLL_PREVIEW: 'attendance.report.payroll.preview',
  PAYROLL_EXPORT_EXCEL: 'attendance.report.payroll.export-excel',
  PAYROLL_RUN_CLOSE: 'attendance.report.payroll.run-close',
  PAYROLL_RUN_LIST: 'attendance.report.payroll.run-list',
} as const;

export const REPORTS_EVENTS = {
  DAILY_REPORT_READY: 'daily_report_ready',
  MONTHLY_REPORT_READY: 'monthly_report_ready',
  PAYROLL_REPORT_READY: 'payroll_report_ready',
} as const;
