import { validateEnvs } from './env.schema';

describe('telemetry envs', () => {
  const validEnv: NodeJS.ProcessEnv = {
    PORT: '3003',
    NATS_SERVER: 'nats://localhost:4222',
    ATTENDANCE_DATABASE_URL:
      'postgresql://attendance_svc:secret@localhost:5432/teamworkflow?schema=attendance',
    WEB_ORIGIN: 'http://localhost:3000',
  };

  it('accepts a valid environment and applies default timeouts', () => {
    expect(validateEnvs(validEnv)).toEqual({
      port: 3003,
      natsServers: ['nats://localhost:4222'],
      attendanceDatabaseUrl: validEnv.ATTENDANCE_DATABASE_URL,
      dbPoolMax: 10,
      dbSsl: false,
      webOrigin: 'http://localhost:3000',
      natsTimeoutMs: 5000,
      rateLimitAuthTtlMs: 60000,
      rateLimitAuthLimit: 100,
      jwtSecret: undefined,
      authCacheTtlMs: 5000,
      defaultReportTz: 'America/Argentina/Buenos_Aires',
      mailEnabled: false,
      mailFrom: 'no-reply@teamworkflow.local',
      mailProvider: 'fake',
    });
  });

  it('accepts custom port and custom timeout values', () => {
    const envs = validateEnvs({
      ...validEnv,
      PORT: '3099',
      NATS_TIMEOUT_MS: '8000',
      RATE_LIMIT_AUTH_LIMIT: '500',
      JWT_SECRET: 'super-secret-jwt-key-1234',
      AUTH_CACHE_TTL_MS: '10000',
    });

    expect(envs.port).toBe(3099);
    expect(envs.natsTimeoutMs).toBe(8000);
    expect(envs.rateLimitAuthLimit).toBe(500);
    expect(envs.jwtSecret).toBe('super-secret-jwt-key-1234');
    expect(envs.authCacheTtlMs).toBe(10000);
  });

  it('throws when ATTENDANCE_DATABASE_URL is missing', () => {
    const { ATTENDANCE_DATABASE_URL: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('ATTENDANCE_DATABASE_URL');
  });

  it('throws when ATTENDANCE_DATABASE_URL is not a postgres URI', () => {
    expect(() =>
      validateEnvs({
        ...validEnv,
        ATTENDANCE_DATABASE_URL: 'mysql://localhost:3306/db',
      }),
    ).toThrow('ATTENDANCE_DATABASE_URL');
  });

  it('parses multiple comma-separated NATS servers', () => {
    const envs = validateEnvs({
      ...validEnv,
      NATS_SERVER: 'nats://node1:4222, nats://node2:4222',
    });

    expect(envs.natsServers).toEqual([
      'nats://node1:4222',
      'nats://node2:4222',
    ]);
  });

  it('accepts NATS_CREDS, converting literal \n sequences, and rejects other content', () => {
    const creds =
      '-----BEGIN NATS USER JWT-----\nabc\n------END NATS USER JWT------';
    expect(validateEnvs({ ...validEnv, NATS_CREDS: creds }).natsCreds).toBe(
      creds.replace(/\n/g, '\n'),
    );
    expect(
      validateEnvs({ ...validEnv, NATS_CREDS: '' }).natsCreds,
    ).toBeUndefined();
    expect(() =>
      validateEnvs({ ...validEnv, NATS_CREDS: 'not-creds' }),
    ).toThrow('NATS_CREDS');
  });

  it('defaults the database pool and ssl settings to the current behavior', () => {
    const envs = validateEnvs(validEnv);

    expect(envs.dbPoolMax).toBe(10);
    expect(envs.dbSsl).toBe(false);
    expect(envs.dbSslCa).toBeUndefined();
  });

  it('accepts DB_POOL_MAX and DB_SSL and rejects an invalid pool size', () => {
    const envs = validateEnvs({
      ...validEnv,
      DB_POOL_MAX: '3',
      DB_SSL: 'true',
    });

    expect(envs.dbPoolMax).toBe(3);
    expect(envs.dbSsl).toBe(true);
    expect(() => validateEnvs({ ...validEnv, DB_POOL_MAX: '0' })).toThrow(
      'DB_POOL_MAX',
    );
  });

  it('accepts DB_SSL_CA with DB_SSL=true, converting literal \n sequences', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----';
    const envs = validateEnvs({
      ...validEnv,
      DB_SSL: 'true',
      DB_SSL_CA: ca.replace(/\n/g, '\\n'),
    });

    expect(envs.dbSslCa).toBe(ca);
  });

  it('rejects DB_SSL_CA without DB_SSL, or with other content', () => {
    expect(() =>
      validateEnvs({
        ...validEnv,
        DB_SSL_CA:
          '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
      }),
    ).toThrow('DB_SSL_CA');
    expect(() =>
      validateEnvs({ ...validEnv, DB_SSL: 'true', DB_SSL_CA: 'not-a-pem' }),
    ).toThrow('DB_SSL_CA');
    expect(
      validateEnvs({ ...validEnv, DB_SSL_CA: '' }).dbSslCa,
    ).toBeUndefined();
  });
});
