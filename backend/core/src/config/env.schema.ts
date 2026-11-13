import * as joi from 'joi';

// Durations understood by jsonwebtoken / ms, e.g. `15m`, `7d`.
const DURATION_PATTERN = /^\d+[smhd]$/;

export interface Envs {
  port: number;
  natsServers: string[];
  authDatabaseUrl: string;
  organizationDatabaseUrl: string;
  billingDatabaseUrl: string;
  tasksDatabaseUrl: string;
  notificationsDatabaseUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3ForcePathStyle: boolean;
  mediaUrlTtlSeconds: number;
  fcmEnabled: boolean;
  fcmProjectId?: string;
  fcmCredentials?: string;
  paymentProvider: 'mercadopago' | 'fake';
  mpAccessToken?: string;
  mpWebhookSecret?: string;
  billingTz: string;
  vatPercent: number;
  trialDays: number;
  dueDays: number;
  graceDays: number;
  dataRetentionDays: number;
  appUrl: string;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtl: string;
}

interface EnvVars {
  PORT: number;
  NATS_SERVER: string[];
  AUTH_DATABASE_URL: string;
  ORGANIZATION_DATABASE_URL: string;
  BILLING_DATABASE_URL: string;
  TASKS_DATABASE_URL: string;
  NOTIFICATIONS_DATABASE_URL: string;
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_FORCE_PATH_STYLE: boolean;
  MEDIA_URL_TTL_SECONDS: number;
  FCM_ENABLED: boolean;
  FCM_PROJECT_ID?: string;
  FCM_CREDENTIALS?: string;
  PAYMENT_PROVIDER: 'mercadopago' | 'fake';
  MP_ACCESS_TOKEN?: string;
  MP_WEBHOOK_SECRET?: string;
  BILLING_TZ: string;
  VAT_PERCENT: number;
  TRIAL_DAYS: number;
  DUE_DAYS: number;
  GRACE_DAYS: number;
  DATA_RETENTION_DAYS: number;
  APP_URL: string;
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
    BILLING_DATABASE_URL: joi
      .string()
      .uri({ scheme: ['postgresql', 'postgres'] })
      .required(),
    TASKS_DATABASE_URL: joi
      .string()
      .uri({ scheme: ['postgresql', 'postgres'] })
      .required(),
    NOTIFICATIONS_DATABASE_URL: joi
      .string()
      .uri({ scheme: ['postgresql', 'postgres'] })
      .required(),
    S3_ENDPOINT: joi.string().uri().default('http://localhost:9000'),
    S3_REGION: joi.string().default('us-east-1'),
    S3_BUCKET: joi.string().default('teamworkflow-tasks'),
    S3_ACCESS_KEY: joi.string().default('minioadmin'),
    S3_SECRET_KEY: joi.string().default('minioadmin'),
    S3_FORCE_PATH_STYLE: joi.boolean().default(true),
    MEDIA_URL_TTL_SECONDS: joi.number().integer().positive().default(300),
    FCM_ENABLED: joi.boolean().default(false),
    FCM_PROJECT_ID: joi.string().when('FCM_ENABLED', {
      is: true,
      then: joi.required(),
      otherwise: joi.optional().allow(''),
    }),
    FCM_CREDENTIALS: joi.string().when('FCM_ENABLED', {
      is: true,
      then: joi.required(),
      otherwise: joi.optional().allow(''),
    }),
    PAYMENT_PROVIDER: joi
      .string()
      .valid('mercadopago', 'fake')
      .default('fake'),
    MP_ACCESS_TOKEN: joi.string().when('PAYMENT_PROVIDER', {
      is: 'mercadopago',
      then: joi.required(),
      otherwise: joi.optional(),
    }),
    MP_WEBHOOK_SECRET: joi.string().when('PAYMENT_PROVIDER', {
      is: 'mercadopago',
      then: joi.required(),
      otherwise: joi.optional(),
    }),
    BILLING_TZ: joi.string().default('America/Argentina/Buenos_Aires'),
    VAT_PERCENT: joi.number().default(21),
    TRIAL_DAYS: joi.number().integer().positive().default(14),
    DUE_DAYS: joi.number().integer().positive().default(10),
    GRACE_DAYS: joi.number().integer().positive().default(7),
    DATA_RETENTION_DAYS: joi.number().integer().positive().default(90),
    APP_URL: joi.string().uri().default('http://localhost:3002'),
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
    billingDatabaseUrl: envVars.BILLING_DATABASE_URL,
    tasksDatabaseUrl: envVars.TASKS_DATABASE_URL,
    notificationsDatabaseUrl: envVars.NOTIFICATIONS_DATABASE_URL,
    s3Endpoint: envVars.S3_ENDPOINT,
    s3Region: envVars.S3_REGION,
    s3Bucket: envVars.S3_BUCKET,
    s3AccessKey: envVars.S3_ACCESS_KEY,
    s3SecretKey: envVars.S3_SECRET_KEY,
    s3ForcePathStyle: envVars.S3_FORCE_PATH_STYLE,
    mediaUrlTtlSeconds: envVars.MEDIA_URL_TTL_SECONDS,
    fcmEnabled: envVars.FCM_ENABLED,
    fcmProjectId: envVars.FCM_PROJECT_ID || undefined,
    fcmCredentials: envVars.FCM_CREDENTIALS || undefined,
    paymentProvider: envVars.PAYMENT_PROVIDER,
    mpAccessToken: envVars.MP_ACCESS_TOKEN,
    mpWebhookSecret: envVars.MP_WEBHOOK_SECRET,
    billingTz: envVars.BILLING_TZ,
    vatPercent: envVars.VAT_PERCENT,
    trialDays: envVars.TRIAL_DAYS,
    dueDays: envVars.DUE_DAYS,
    graceDays: envVars.GRACE_DAYS,
    dataRetentionDays: envVars.DATA_RETENTION_DAYS,
    appUrl: envVars.APP_URL,
    jwtSecret: envVars.JWT_SECRET,
    accessTokenTtl: envVars.ACCESS_TOKEN_TTL,
    refreshTokenTtl: envVars.REFRESH_TOKEN_TTL,
  };
}
