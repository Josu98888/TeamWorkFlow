// Fallback test environment variables for Jest unit & integration tests.
process.env.PORT ??= '3003';
process.env.NATS_SERVER ??= 'nats://localhost:4222';
process.env.ATTENDANCE_DATABASE_URL ??=
  'postgresql://attendance_svc:test@localhost:5432/teamworkflow?schema=attendance';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';
process.env.NATS_TIMEOUT_MS ??= '5000';
process.env.RATE_LIMIT_AUTH_TTL_MS ??= '60000';
process.env.RATE_LIMIT_AUTH_LIMIT ??= '100';
