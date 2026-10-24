import { validateEnvs } from './env.schema';

describe('envs', () => {
  const validEnv: NodeJS.ProcessEnv = {
    PORT: '3000',
    NATS_SERVER: 'nats://localhost:4222',
    AUTH_DATABASE_URL:
      'postgresql://auth_svc:secret@localhost:5432/teamworkflow?schema=auth',
    JWT_SECRET: 'a-secret-with-at-least-32-characters!',
  };

  it('accepts a valid environment, converts PORT and defaults the TTLs', () => {
    expect(validateEnvs(validEnv)).toEqual({
      port: 3000,
      natsServers: ['nats://localhost:4222'],
      authDatabaseUrl: validEnv.AUTH_DATABASE_URL,
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
