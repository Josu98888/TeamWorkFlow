import { validateEnvs } from './env.schema';

describe('envs', () => {
  const validEnv: NodeJS.ProcessEnv = {
    PORT: '3000',
    NATS_SERVER: 'nats://localhost:4222',
    AUTH_DATABASE_URL:
      'postgresql://auth_svc:secret@localhost:5432/teamworkflow?schema=auth',
    ORGANIZATION_DATABASE_URL:
      'postgresql://organization_svc:secret@localhost:5432/teamworkflow?schema=organization',
    BILLING_DATABASE_URL:
      'postgresql://billing_svc:secret@localhost:5432/teamworkflow?schema=billing',
    TASKS_DATABASE_URL:
      'postgresql://tasks_svc:secret@localhost:5432/teamworkflow?schema=tasks',
    NOTIFICATIONS_DATABASE_URL:
      'postgresql://notifications_svc:secret@localhost:5432/teamworkflow?schema=notifications',
    JWT_SECRET: 'a-secret-with-at-least-32-characters!',
  };

  it('accepts a valid environment, converts PORT and defaults the TTLs, billing and tasks settings', () => {
    expect(validateEnvs(validEnv)).toEqual({
      port: 3000,
      natsServers: ['nats://localhost:4222'],
      authDatabaseUrl: validEnv.AUTH_DATABASE_URL,
      organizationDatabaseUrl: validEnv.ORGANIZATION_DATABASE_URL,
      billingDatabaseUrl: validEnv.BILLING_DATABASE_URL,
      tasksDatabaseUrl: validEnv.TASKS_DATABASE_URL,
      notificationsDatabaseUrl: validEnv.NOTIFICATIONS_DATABASE_URL,
      s3Endpoint: 'http://localhost:9000',
      s3Region: 'us-east-1',
      s3Bucket: 'teamworkflow-tasks',
      s3AccessKey: 'minioadmin',
      s3SecretKey: 'minioadmin',
      s3ForcePathStyle: true,
      mediaUrlTtlSeconds: 300,
      fcmEnabled: false,
      fcmProjectId: undefined,
      fcmCredentials: undefined,
      paymentProvider: 'fake',
      mpAccessToken: undefined,
      mpWebhookSecret: undefined,
      billingTz: 'America/Argentina/Buenos_Aires',
      vatPercent: 21,
      trialDays: 14,
      dueDays: 10,
      graceDays: 7,
      dataRetentionDays: 90,
      appUrl: 'http://localhost:3002',
      jwtSecret: validEnv.JWT_SECRET,
      accessTokenTtl: '15m',
      refreshTokenTtl: '7d',
    });
  });

  it('accepts custom token TTLs', () => {
    const envs = validateEnvs({
      ...validEnv,
      ACCESS_TOKEN_TTL: '30m',
      REFRESH_TOKEN_TTL: '14d',
    });

    expect(envs.accessTokenTtl).toBe('30m');
    expect(envs.refreshTokenTtl).toBe('14d');
  });

  it.each(['15 minutes', '15', 'm15'])('rejects the TTL %s', (ttl) => {
    expect(() => validateEnvs({ ...validEnv, ACCESS_TOKEN_TTL: ttl })).toThrow(
      'ACCESS_TOKEN_TTL',
    );
    expect(() => validateEnvs({ ...validEnv, REFRESH_TOKEN_TTL: ttl })).toThrow(
      'REFRESH_TOKEN_TTL',
    );
  });

  it('throws when AUTH_DATABASE_URL is missing', () => {
    const { AUTH_DATABASE_URL: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('AUTH_DATABASE_URL');
  });

  it('throws when AUTH_DATABASE_URL is not a postgres URI', () => {
    expect(() =>
      validateEnvs({ ...validEnv, AUTH_DATABASE_URL: 'mysql://localhost/db' }),
    ).toThrow('AUTH_DATABASE_URL');
  });

  it('throws when ORGANIZATION_DATABASE_URL is missing or not a postgres URI', () => {
    const { ORGANIZATION_DATABASE_URL: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('ORGANIZATION_DATABASE_URL');
    expect(() =>
      validateEnvs({
        ...validEnv,
        ORGANIZATION_DATABASE_URL: 'mysql://localhost/db',
      }),
    ).toThrow('ORGANIZATION_DATABASE_URL');
  });

  it('throws when BILLING_DATABASE_URL is missing or not a postgres URI', () => {
    const { BILLING_DATABASE_URL: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('BILLING_DATABASE_URL');
    expect(() =>
      validateEnvs({
        ...validEnv,
        BILLING_DATABASE_URL: 'mysql://localhost/db',
      }),
    ).toThrow('BILLING_DATABASE_URL');
  });

  it('throws when TASKS_DATABASE_URL is missing or not a postgres URI', () => {
    const { TASKS_DATABASE_URL: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('TASKS_DATABASE_URL');
    expect(() =>
      validateEnvs({
        ...validEnv,
        TASKS_DATABASE_URL: 'mysql://localhost/db',
      }),
    ).toThrow('TASKS_DATABASE_URL');
  });

  it('throws when NOTIFICATIONS_DATABASE_URL is missing or not a postgres URI', () => {
    const { NOTIFICATIONS_DATABASE_URL: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('NOTIFICATIONS_DATABASE_URL');
    expect(() =>
      validateEnvs({
        ...validEnv,
        NOTIFICATIONS_DATABASE_URL: 'mysql://localhost/db',
      }),
    ).toThrow('NOTIFICATIONS_DATABASE_URL');
  });

  it('requires FCM_PROJECT_ID and FCM_CREDENTIALS when FCM_ENABLED is true', () => {
    expect(() =>
      validateEnvs({
        ...validEnv,
        FCM_ENABLED: 'true',
      }),
    ).toThrow('FCM_PROJECT_ID');

    const envs = validateEnvs({
      ...validEnv,
      FCM_ENABLED: 'true',
      FCM_PROJECT_ID: 'twf-project',
      FCM_CREDENTIALS: '{"type":"service_account"}',
    });

    expect(envs.fcmEnabled).toBe(true);
    expect(envs.fcmProjectId).toBe('twf-project');
    expect(envs.fcmCredentials).toBe('{"type":"service_account"}');
  });

  it('validates mercadopago payment provider requirements', () => {
    expect(() =>
      validateEnvs({
        ...validEnv,
        PAYMENT_PROVIDER: 'mercadopago',
      }),
    ).toThrow('MP_ACCESS_TOKEN');

    const envs = validateEnvs({
      ...validEnv,
      PAYMENT_PROVIDER: 'mercadopago',
      MP_ACCESS_TOKEN: 'mp-test-token',
      MP_WEBHOOK_SECRET: 'mp-webhook-secret',
      BILLING_TZ: 'UTC',
      VAT_PERCENT: '10.5',
      TRIAL_DAYS: '30',
      DUE_DAYS: '15',
      GRACE_DAYS: '5',
      DATA_RETENTION_DAYS: '60',
      APP_URL: 'https://app.example.com',
    });

    expect(envs.paymentProvider).toBe('mercadopago');
    expect(envs.mpAccessToken).toBe('mp-test-token');
    expect(envs.mpWebhookSecret).toBe('mp-webhook-secret');
    expect(envs.billingTz).toBe('UTC');
    expect(envs.vatPercent).toBe(10.5);
    expect(envs.trialDays).toBe(30);
    expect(envs.dueDays).toBe(15);
    expect(envs.graceDays).toBe(5);
    expect(envs.dataRetentionDays).toBe(60);
    expect(envs.appUrl).toBe('https://app.example.com');
  });

  it('throws when JWT_SECRET is missing or shorter than 32 characters', () => {
    const { JWT_SECRET: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('JWT_SECRET');
    expect(() => validateEnvs({ ...validEnv, JWT_SECRET: 'short' })).toThrow(
      'JWT_SECRET',
    );
  });

  it('splits and trims a comma-separated NATS_SERVER', () => {
    const envs = validateEnvs({
      ...validEnv,
      NATS_SERVER: 'nats://a:4222, nats://b:4222',
    });

    expect(envs.natsServers).toEqual(['nats://a:4222', 'nats://b:4222']);
  });

  it('throws when PORT is missing', () => {
    const { PORT: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('PORT');
  });

  it('throws when PORT is not a number', () => {
    expect(() => validateEnvs({ ...validEnv, PORT: 'abc' })).toThrow('PORT');
  });

  it('throws when NATS_SERVER is missing', () => {
    const { NATS_SERVER: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('NATS_SERVER');
  });

  it('throws when NATS_SERVER is not a URI', () => {
    expect(() =>
      validateEnvs({ ...validEnv, NATS_SERVER: 'not a uri' }),
    ).toThrow('NATS_SERVER');
  });
});
