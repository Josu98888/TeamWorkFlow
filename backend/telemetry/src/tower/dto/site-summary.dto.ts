import type { Alert } from '../../prisma/generated/client';

export interface SiteSummary {
  siteId: string;
  expected: number;
  present: number;
  openAlerts: number;
}

export interface SiteSummarySnapshot extends SiteSummary {
  alerts: Alert[];
}

export interface TowerSnapshotResponse {
  items: SiteSummarySnapshot[];
}
