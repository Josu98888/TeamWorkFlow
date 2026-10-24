import { validateEnvs } from './env.schema';

describe('envs', () => {
  const validEnv: NodeJS.ProcessEnv = {
    PORT: '3000',
    NATS_SERVER: 'nats://localhost:4222',
  };

  it('accepts a valid environment and converts PORT to a number', () => {
    expect(validateEnvs(validEnv)).toEqual({
      port: 3000,
      natsServers: ['nats://localhost:4222'],
    });
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
