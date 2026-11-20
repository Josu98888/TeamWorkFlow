// Env for the e2e smoke test: the config module validates process.env on
// import, but the smoke test never opens a database or NATS connection.
process.env.PORT ??= '3000';
process.env.NATS_SERVER ??= 'nats://localhost:4222';
process.env.AUTH_DATABASE_URL ??=
  'postgresql://auth_svc:unused@localhost:5432/teamworkflow?schema=auth';
process.env.ORGANIZATION_DATABASE_URL ??=
  'postgresql://organization_svc:unused@localhost:5432/teamworkflow?schema=organization';
process.env.BILLING_DATABASE_URL ??=
  'postgresql://billing_svc:unused@localhost:5432/teamworkflow?schema=billing';
process.env.TASKS_DATABASE_URL ??=
  'postgresql://tasks_svc:unused@localhost:5432/teamworkflow?schema=tasks';
process.env.NOTIFICATIONS_DATABASE_URL ??=
  'postgresql://notifications_svc:unused@localhost:5432/teamworkflow?schema=notifications';
process.env.WEB_ORIGIN ??= 'http://localhost:3002';
process.env.RATE_LIMIT_PUBLIC_TTL_MS ??= '60000';
process.env.RATE_LIMIT_PUBLIC_LIMIT ??= '30';
process.env.RATE_LIMIT_AUTH_TTL_MS ??= '60000';
process.env.RATE_LIMIT_AUTH_LIMIT ??= '300';
process.env.JWT_SECRET ??= 'e2e-smoke-secret-e2e-smoke-secret-0000';
