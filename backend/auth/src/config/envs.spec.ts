import { validateEnvs } from './env.schema';

// Covers: S1.2
describe('envs', () => {
  const validEnv: NodeJS.ProcessEnv = {
    NATS_SERVER: 'nats://localhost:4222',
    DATABASE_URL:
      'postgresql://auth_svc:pass@localhost:5432/teamworkflow?schema=auth',
    JWT_SECRET: 'a'.repeat(32),
  };

  it('accepts a valid environment and applies the TTL defaults', () => {
    const envs = validateEnvs(validEnv);

    expect(envs).toEqual({
      natsServers: ['nats://localhost:4222'],
      databaseUrl: validEnv.DATABASE_URL,
      jwtSecret: validEnv.JWT_SECRET,
      accessTokenTtl: '15m',
      refreshTokenTtl: '7d',
    });
  });

  it('splits and trims a comma-separated NATS_SERVER', () => {
    const envs = validateEnvs({
      ...validEnv,
      NATS_SERVER: 'nats://a:4222, nats://b:4222',
    });

    expect(envs.natsServers).toEqual(['nats://a:4222', 'nats://b:4222']);
  });

  it('keeps explicit TTLs', () => {
    const envs = validateEnvs({
      ...validEnv,
      ACCESS_TOKEN_TTL: '5m',
      REFRESH_TOKEN_TTL: '30d',
    });

    expect(envs.accessTokenTtl).toBe('5m');
    expect(envs.refreshTokenTtl).toBe('30d');
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('JWT_SECRET');
  });

  it('throws when JWT_SECRET has 31 characters', () => {
    expect(() =>
      validateEnvs({ ...validEnv, JWT_SECRET: 'a'.repeat(31) }),
    ).toThrow('JWT_SECRET');
  });

  it('throws when DATABASE_URL is not a postgres URL', () => {
    expect(() =>
      validateEnvs({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' }),
    ).toThrow('DATABASE_URL');
  });

  it('throws when NATS_SERVER is missing', () => {
    const { NATS_SERVER: _omitted, ...env } = validEnv;

    expect(() => validateEnvs(env)).toThrow('NATS_SERVER');
  });

  it('throws on an invalid TTL format', () => {
    expect(() =>
      validateEnvs({ ...validEnv, ACCESS_TOKEN_TTL: '15 minutes' }),
    ).toThrow('ACCESS_TOKEN_TTL');
  });

  it('never includes the secret value in the error message', () => {
    const secret = 's'.repeat(31);

    expect(() => validateEnvs({ ...validEnv, JWT_SECRET: secret })).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(secret) as string,
      }),
    );
  });
});
