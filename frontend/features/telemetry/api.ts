import { USE_MOCKS } from '@/shared/lib/config';
import { telemetryHttpApi } from './http';
import { telemetryMockApi } from './mock';
import type {
  Alert,
  AlertsPage,
  ClockEvent,
  ClockEventsPage,
  CorrectClockEventInput,
  CreateClockEventInput,
  CreateManualClockEventInput,
  ListAlertsQuery,
  ListClockEventsQuery,
  ListWorkdaysQuery,
  TowerSnapshotResponse,
  Workday,
  WorkdaysPage,
} from './types';

export type TelemetryApi = {
  getTowerSnapshot: () => Promise<TowerSnapshotResponse>;
  listAlerts: (query?: ListAlertsQuery) => Promise<AlertsPage>;
  acknowledgeAlert: (alertId: string) => Promise<Alert>;
  resolveAlert: (alertId: string, reason?: string) => Promise<Alert>;
  listClockEvents: (query?: ListClockEventsQuery) => Promise<ClockEventsPage>;
  createClockEvent: (input: CreateClockEventInput) => Promise<ClockEvent>;
  createManualClockEvent: (input: CreateManualClockEventInput) => Promise<ClockEvent>;
  correctClockEvent: (clockEventId: string, input: CorrectClockEventInput) => Promise<ClockEvent>;
  listWorkdays: (query?: ListWorkdaysQuery) => Promise<WorkdaysPage>;
  getWorkday: (shiftId: string) => Promise<Workday>;
};

// The only mock/real switch of this domain (see `shared/lib/config.ts`).
export const telemetryApi: TelemetryApi = USE_MOCKS ? telemetryMockApi : telemetryHttpApi;
