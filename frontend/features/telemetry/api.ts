import { USE_MOCKS } from '@/shared/lib/config';
import { telemetryHttpApi } from './http';
import { telemetryMockApi } from './mock';
import type {
  ActiveClockStatus,
  Alert,
  AlertsPage,
  ClockEvent,
  ClockEventsPage,
  CorrectClockEventInput,
  CreateClockEventInput,
  CreateManualClockEventInput,
  DailyAttendanceReport,
  EmployeeCompensationView,
  ListAlertsQuery,
  ListClockEventsQuery,
  ListWorkdaysQuery,
  MonthlyAttendanceReport,
  MonthlyPayrollCalculation,
  PostOvertimeRateView,
  ReportRecipientView,
  ReportRecipientsResponse,
  TowerSnapshotResponse,
  UpsertEmployeeCompensationInput,
  UpsertPostOvertimeRateInput,
  UpsertReportRecipientInput,
  Workday,
  WorkdaysPage,
} from './types';

export type TelemetryApi = {
  getTowerSnapshot: () => Promise<TowerSnapshotResponse>;
  listAlerts: (query?: ListAlertsQuery) => Promise<AlertsPage>;
  acknowledgeAlert: (alertId: string) => Promise<Alert>;
  resolveAlert: (alertId: string, reason?: string) => Promise<Alert>;
  listClockEvents: (query?: ListClockEventsQuery) => Promise<ClockEventsPage>;
  getActiveClockStatus: () => Promise<ActiveClockStatus>;
  createClockEvent: (input: CreateClockEventInput) => Promise<ClockEvent>;
  createManualClockEvent: (input: CreateManualClockEventInput) => Promise<ClockEvent>;
  correctClockEvent: (clockEventId: string, input: CorrectClockEventInput) => Promise<ClockEvent>;
  listWorkdays: (query?: ListWorkdaysQuery) => Promise<WorkdaysPage>;
  getWorkday: (shiftId: string) => Promise<Workday>;
  getDailyReport: (query?: { date?: string; siteId?: string }) => Promise<DailyAttendanceReport>;
  downloadDailyReportPdf: (query?: { date?: string; siteId?: string }) => Promise<void>;
  getMonthlyReport: (query?: { period?: string; siteId?: string; employeeId?: string }) => Promise<MonthlyAttendanceReport>;
  downloadMonthlyReportPdf: (query?: { period?: string; siteId?: string; employeeId?: string }) => Promise<void>;
  getMonthlyPayroll: (query?: { period?: string; siteId?: string; employeeId?: string }) => Promise<MonthlyPayrollCalculation>;
  downloadMonthlyPayrollExcel: (query?: { period?: string; siteId?: string; employeeId?: string }) => Promise<void>;
  listEmployeeCompensations: () => Promise<{ items: EmployeeCompensationView[]; total: number }>;
  upsertEmployeeCompensation: (employeeId: string, input: UpsertEmployeeCompensationInput) => Promise<EmployeeCompensationView>;
  listPostOvertimeRates: () => Promise<{ items: PostOvertimeRateView[]; total: number }>;
  upsertPostOvertimeRate: (postId: string, input: UpsertPostOvertimeRateInput) => Promise<PostOvertimeRateView>;
  listReportRecipients: () => Promise<ReportRecipientsResponse>;
  upsertReportRecipient: (userId: string, input: UpsertReportRecipientInput) => Promise<ReportRecipientView>;
  removeReportRecipient: (userId: string) => Promise<void>;
};

// The only mock/real switch of this domain (see `shared/lib/config.ts`).
export const telemetryApi: TelemetryApi = USE_MOCKS ? telemetryMockApi : telemetryHttpApi;
