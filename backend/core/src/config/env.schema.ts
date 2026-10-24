import * as joi from 'joi';

export interface Envs {
  port: number;
  natsServers: string[];
}

interface EnvVars {
  PORT: number;
  NATS_SERVER: string[];
}

const envsSchema = joi
  .object<EnvVars>({
    PORT: joi.number().port().required(),
    NATS_SERVER: joi.array().items(joi.string().uri()).min(1).required(),
  })
  .unknown(true);

export function validateEnvs(raw: NodeJS.ProcessEnv): Envs {
  const { error, value } = envsSchema.validate(
    {
      ...raw,
      NATS_SERVER: raw.NATS_SERVER?.split(',').map((server) => server.trim()),
    },
    { abortEarly: false },
  );

  if (error) {
    // Report only the variable names: some joi messages embed the value,
    // and later slices add secrets to this schema.
    const keys = [...new Set(error.details.map((detail) => detail.path[0]))];
    throw new Error(
      `Config validation error: invalid or missing ${keys.join(', ')}`,
    );
  }

  const envVars = value as EnvVars;

  return {
    port: envVars.PORT,
    natsServers: envVars.NATS_SERVER,
  };
}
