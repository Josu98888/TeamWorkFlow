import * as joi from 'joi';

export interface Envs {
  port: number;
  natsServers: string[];
  attendanceDatabaseUrl: string;
  webOrigin: string;
  natsTimeoutMs: number;
  rateLimitAuthTtlMs: number;
  rateLimitAuthLimit: number;
}

interface EnvVars {
  PORT: number;
  NATS_SERVER: string[];
  ATTENDANCE_DATABASE_URL: string;
  WEB_ORIGIN: string;
  NATS_TIMEOUT_MS: number;
  RATE_LIMIT_AUTH_TTL_MS: number;
  RATE_LIMIT_AUTH_LIMIT: number;
}

const envsSchema = joi
  .object<EnvVars>({
    PORT: joi.number().port().default(3003),
    NATS_SERVER: joi.array().items(joi.string().uri()).min(1).default(['nats://localhost:4222']),
    ATTENDANCE_DATABASE_URL: joi
      .string()
      .uri({ scheme: ['postgresql', 'postgres'] })
      .required(),
    WEB_ORIGIN: joi.string().uri().default('http://localhost:3000'),
    NATS_TIMEOUT_MS: joi.number().positive().default(5000),
    RATE_LIMIT_AUTH_TTL_MS: joi.number().positive().default(60000),
    RATE_LIMIT_AUTH_LIMIT: joi.number().positive().default(100),
  })
  .unknown(true);

export function validateEnvs(raw: NodeJS.ProcessEnv): Envs {
  const { error, value } = envsSchema.validate(
    {
      ...raw,
      PORT: raw.PORT ? Number(raw.PORT) : 3003,
      NATS_SERVER: raw.NATS_SERVER
        ? raw.NATS_SERVER.split(',').map((server) => server.trim())
        : ['nats://localhost:4222'],
      NATS_TIMEOUT_MS: raw.NATS_TIMEOUT_MS ? Number(raw.NATS_TIMEOUT_MS) : 5000,
      RATE_LIMIT_AUTH_TTL_MS: raw.RATE_LIMIT_AUTH_TTL_MS ? Number(raw.RATE_LIMIT_AUTH_TTL_MS) : 60000,
      RATE_LIMIT_AUTH_LIMIT: raw.RATE_LIMIT_AUTH_LIMIT ? Number(raw.RATE_LIMIT_AUTH_LIMIT) : 100,
    },
    { abortEarly: false },
  );

  if (error) {
    const keys = [...new Set(error.details.map((detail) => detail.path[0]))];
    throw new Error(
      `Config validation error: invalid or missing ${keys.join(', ')}`,
    );
  }

  const envVars = value as EnvVars;

  return {
    port: envVars.PORT,
    natsServers: envVars.NATS_SERVER,
    attendanceDatabaseUrl: envVars.ATTENDANCE_DATABASE_URL,
    webOrigin: envVars.WEB_ORIGIN,
    natsTimeoutMs: envVars.NATS_TIMEOUT_MS,
    rateLimitAuthTtlMs: envVars.RATE_LIMIT_AUTH_TTL_MS,
    rateLimitAuthLimit: envVars.RATE_LIMIT_AUTH_LIMIT,
  };
}
