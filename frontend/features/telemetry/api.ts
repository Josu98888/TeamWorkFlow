import { USE_MOCKS } from '@/shared/lib/config';
import { telemetryHttpApi } from './http';
import { telemetryMockApi } from './mock';
import type { Alert, AlertsPage, ListAlertsQuery, TowerSnapshotResponse } from './types';

export type TelemetryApi = {
  getTowerSnapshot: () => Promise<TowerSnapshotResponse>;
  listAlerts: (query?: ListAlertsQuery) => Promise<AlertsPage>;
  acknowledgeAlert: (alertId: string) => Promise<Alert>;
  resolveAlert: (alertId: string, reason?: string) => Promise<Alert>;
};

// The only mock/real switch of this domain (see `shared/lib/config.ts`).
export const telemetryApi: TelemetryApi = USE_MOCKS ? telemetryMockApi : telemetryHttpApi;
