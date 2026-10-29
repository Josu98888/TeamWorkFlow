import { MOCK_LATENCY_MS } from './config';

/** Resolves `value` after a short delay, like a network call would. */
export function mockResponse<T>(value: T, delayMs = MOCK_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), delayMs));
}

/** ISO instant `minutes` away from now (negative = in the past). */
export function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** ISO instant for today at a given local hour/minute, shifted by `dayOffset` days. */
export function todayAt(hour: number, minute = 0, dayOffset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}
