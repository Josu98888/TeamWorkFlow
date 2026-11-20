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

/**
 * Origin of the Socket.IO gateway of telemetry (the reverse proxy, path `/ws`).
 * Unset: the local proxy. Empty: `undefined`, so Socket.IO uses the page origin
 * (an empty string would make it build the URL `http://`).
 */
const RAW_WS_URL = process.env.NEXT_PUBLIC_WS_URL;
export const WS_URL: string | undefined =
  RAW_WS_URL === undefined ? 'http://localhost:8080' : RAW_WS_URL || undefined;

/** Fake network latency so loading states are visible in the demo. */
export const MOCK_LATENCY_MS = 350;
