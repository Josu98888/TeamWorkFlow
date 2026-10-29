import * as joi from 'joi';

// Durations understood by jsonwebtoken / ms, e.g. `15m`, `7d`.
const DURATION_PATTERN = /^\d+[smhd]$/;

export interface Envs {
  port: number;
  natsServers: string[];
  authDatabaseUrl: string;
  organizationDatabaseUrl: string;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtl: string;
}

interface EnvVars {
  PORT: number;
  NATS_SERVER: string[];
  AUTH_DATABASE_URL: string;
  ORGANIZATION_DATABASE_URL: string;
  JWT_SECRET: string;
  ACCESS_TOKEN_TTL: string;
  REFRESH_TOKEN_TTL: string;
}

const envsSchema = joi
  .object<EnvVars>({
    PORT: joi.number().port().required(),
    NATS_SERVER: joi.array().items(joi.string().uri()).min(1).required(),
    AUTH_DATABASE_URL: joi
      .string()
      .uri({ scheme: ['postgresql', 'postgres'] })
      .required(),
    ORGANIZATION_DATABASE_URL: joi
      .string()
      .uri({ scheme: ['postgresql', 'postgres'] })
      .required(),
    JWT_SECRET: joi.string().min(32).required(),
    ACCESS_TOKEN_TTL: joi.string().pattern(DURATION_PATTERN).default('15m'),
    REFRESH_TOKEN_TTL: joi.string().pattern(DURATION_PATTERN).default('7d'),
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
    // and these variables hold secrets.
    const keys = [...new Set(error.details.map((detail) => detail.path[0]))];
    throw new Error(
      `Config validation error: invalid or missing ${keys.join(', ')}`,
    );
  }

  const envVars = value as EnvVars;

  return {
    port: envVars.PORT,
    natsServers: envVars.NATS_SERVER,
    authDatabaseUrl: envVars.AUTH_DATABASE_URL,
    organizationDatabaseUrl: envVars.ORGANIZATION_DATABASE_URL,
    jwtSecret: envVars.JWT_SECRET,
    accessTokenTtl: envVars.ACCESS_TOKEN_TTL,
    refreshTokenTtl: envVars.REFRESH_TOKEN_TTL,
  };
}
