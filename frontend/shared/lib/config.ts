/**
 * Data source switch for the whole frontend.
 *
 * Mocks are ON unless `NEXT_PUBLIC_USE_MOCKS=false` is set (build/start time,
 * `frontend/.env.local`). Every domain `api.ts` reads this flag and exports either
 * its mock implementation or its HTTP implementation, so screens never change.
 */
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== 'false';

/** Public HTTP API prefix. `core` lives under it; `telemetry` under `/telemetry`. */
export const API_PREFIX = '/api/v1';
export const TELEMETRY_API_PREFIX = `${API_PREFIX}/telemetry`;

/** Fake network latency so loading states are visible in the demo. */
export const MOCK_LATENCY_MS = 350;
