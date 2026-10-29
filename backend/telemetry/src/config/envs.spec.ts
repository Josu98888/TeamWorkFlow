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
      webOrigin: 'http://localhost:3000',
      natsTimeoutMs: 5000,
      rateLimitAuthTtlMs: 60000,
      rateLimitAuthLimit: 100,
    });
  });

  it('accepts custom port and custom timeout values', () => {
    const envs = validateEnvs({
      ...validEnv,
      PORT: '3099',
      NATS_TIMEOUT_MS: '8000',
      RATE_LIMIT_AUTH_LIMIT: '500',
    });

    expect(envs.port).toBe(3099);
    expect(envs.natsTimeoutMs).toBe(8000);
    expect(envs.rateLimitAuthLimit).toBe(500);
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
});
