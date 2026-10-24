const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

// Parses the `<n><s|m|h|d>` durations validated in `config/env.schema.ts`
// (e.g. `15m`, `7d`) to seconds.
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error('Invalid duration');
  }
  return Number(match[1]) * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
}
