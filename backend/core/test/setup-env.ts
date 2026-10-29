// Env for the e2e smoke test: the config module validates process.env on
// import, but the smoke test never opens a database or NATS connection.
process.env.PORT ??= '3000';
process.env.NATS_SERVER ??= 'nats://localhost:4222';
process.env.AUTH_DATABASE_URL ??=
  'postgresql://auth_svc:unused@localhost:5432/teamworkflow?schema=auth';
process.env.ORGANIZATION_DATABASE_URL ??=
  'postgresql://organization_svc:unused@localhost:5432/teamworkflow?schema=organization';
process.env.JWT_SECRET ??= 'e2e-smoke-secret-e2e-smoke-secret-0000';
