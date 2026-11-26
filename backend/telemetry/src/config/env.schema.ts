import * as joi from 'joi';
import { DB_SSL_CA_PATTERN, normalizePem } from '../prisma/pg-pool-config';
import { NATS_CREDS_PATTERN, normalizeNatsCreds } from './nats-options';

export interface Envs {
  port: number;
  natsServers: string[];
  natsCreds?: string;
  attendanceDatabaseUrl: string;
  dbPoolMax: number;
  dbSsl: boolean;
  dbSslCa?: string;
  webOrigin: string;
  natsTimeoutMs: number;
  rateLimitAuthTtlMs: number;
  rateLimitAuthLimit: number;
  jwtSecret?: string;
  authCacheTtlMs: number;
  defaultReportTz: string;
  mailEnabled: boolean;
  mailFrom: string;
  mailProvider: 'fake' | 'resend' | 'smtp';
  resendApiKey?: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPass?: string;
}

interface EnvVars {
  PORT: number;
  NATS_SERVER: string[];
  NATS_CREDS?: string;
  ATTENDANCE_DATABASE_URL: string;
  DB_POOL_MAX: number;
  DB_SSL: boolean;
  DB_SSL_CA?: string;
  WEB_ORIGIN: string;
  NATS_TIMEOUT_MS: number;
  RATE_LIMIT_AUTH_TTL_MS: number;
  RATE_LIMIT_AUTH_LIMIT: number;
  JWT_SECRET?: string;
  AUTH_CACHE_TTL_MS: number;
  DEFAULT_REPORT_TZ: string;
  MAIL_ENABLED: boolean;
  MAIL_FROM: string;
  MAIL_PROVIDER: 'fake' | 'resend' | 'smtp';
  RESEND_API_KEY?: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASS?: string;
}

const envsSchema = joi
  .object<EnvVars>({
    PORT: joi.number().port().default(3003),
    NATS_CREDS: joi.string().pattern(NATS_CREDS_PATTERN),
    NATS_SERVER: joi
      .array()
      .items(joi.string().uri())
      .min(1)
      .default(['nats://localhost:4222']),
    ATTENDANCE_DATABASE_URL: joi
      .string()
      .uri({ scheme: ['postgresql', 'postgres'] })
      .required(),
    // Pool size of the Prisma client. The default is the pg default; lower it
    // on hosts with a small connection budget.
    DB_POOL_MAX: joi.number().integer().min(1).default(10),
    // Encrypt database connections. `DB_SSL_CA` (PEM) makes them verified; it
    // needs `DB_SSL=true`.
    DB_SSL: joi.boolean().default(false),
    DB_SSL_CA: joi.string().pattern(DB_SSL_CA_PATTERN).when('DB_SSL', {
      is: true,
      then: joi.optional(),
      otherwise: joi.forbidden(),
    }),
    WEB_ORIGIN: joi.string().uri().default('http://localhost:3000'),
    NATS_TIMEOUT_MS: joi.number().positive().default(5000),
    RATE_LIMIT_AUTH_TTL_MS: joi.number().positive().default(60000),
    RATE_LIMIT_AUTH_LIMIT: joi.number().positive().default(100),
    JWT_SECRET: joi.string().min(16).optional(),
    AUTH_CACHE_TTL_MS: joi.number().min(0).default(5000),
    DEFAULT_REPORT_TZ: joi.string().default('America/Argentina/Buenos_Aires'),
    MAIL_ENABLED: joi.boolean().default(false),
    MAIL_FROM: joi.string().email().default('no-reply@teamworkflow.local'),
    MAIL_PROVIDER: joi.string().valid('fake', 'resend', 'smtp').default('fake'),
    RESEND_API_KEY: joi.string().allow('').optional(),
    SMTP_HOST: joi.string().hostname().default('smtp.gmail.com'),
    SMTP_PORT: joi.number().port().default(465),
    SMTP_SECURE: joi.boolean().optional(),
    SMTP_USER: joi.string().allow('').optional(),
    SMTP_PASS: joi.string().allow('').optional(),
  })
  .unknown(true);

export function validateEnvs(raw: NodeJS.ProcessEnv): Envs {
  const { error, value } = envsSchema.validate(
    {
      ...raw,
      NATS_CREDS: normalizeNatsCreds(raw.NATS_CREDS),
      DB_SSL_CA: normalizePem(raw.DB_SSL_CA),
      PORT: raw.PORT ? Number(raw.PORT) : 3003,
      NATS_SERVER: raw.NATS_SERVER
        ? raw.NATS_SERVER.split(',').map((server) => server.trim())
        : ['nats://localhost:4222'],
      NATS_TIMEOUT_MS: raw.NATS_TIMEOUT_MS ? Number(raw.NATS_TIMEOUT_MS) : 5000,
      RATE_LIMIT_AUTH_TTL_MS: raw.RATE_LIMIT_AUTH_TTL_MS
        ? Number(raw.RATE_LIMIT_AUTH_TTL_MS)
        : 60000,
      RATE_LIMIT_AUTH_LIMIT: raw.RATE_LIMIT_AUTH_LIMIT
        ? Number(raw.RATE_LIMIT_AUTH_LIMIT)
        : 100,
      AUTH_CACHE_TTL_MS:
        raw.AUTH_CACHE_TTL_MS !== undefined
          ? Number(raw.AUTH_CACHE_TTL_MS)
          : 5000,
      SMTP_PORT: raw.SMTP_PORT ? Number(raw.SMTP_PORT) : 465,
      ...(raw.SMTP_SECURE === '' ? { SMTP_SECURE: undefined } : {}),
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
  const smtpPort = envVars.SMTP_PORT;
  const smtpSecure = envVars.SMTP_SECURE ?? smtpPort === 465;
  const smtpUser = envVars.SMTP_USER?.trim() || undefined;
  const rawSmtpPass = envVars.SMTP_PASS?.trim() || undefined;
  const smtpPass =
    rawSmtpPass && envVars.SMTP_HOST.toLowerCase() === 'smtp.gmail.com'
      ? rawSmtpPass.replace(/\s+/g, '')
      : rawSmtpPass;

  return {
    port: envVars.PORT,
    natsServers: envVars.NATS_SERVER,
    natsCreds: envVars.NATS_CREDS,
    attendanceDatabaseUrl: envVars.ATTENDANCE_DATABASE_URL,
    dbPoolMax: envVars.DB_POOL_MAX,
    dbSsl: envVars.DB_SSL,
    dbSslCa: envVars.DB_SSL_CA,
    webOrigin: envVars.WEB_ORIGIN,
    natsTimeoutMs: envVars.NATS_TIMEOUT_MS,
    rateLimitAuthTtlMs: envVars.RATE_LIMIT_AUTH_TTL_MS,
    rateLimitAuthLimit: envVars.RATE_LIMIT_AUTH_LIMIT,
    jwtSecret: envVars.JWT_SECRET,
    authCacheTtlMs: envVars.AUTH_CACHE_TTL_MS,
    defaultReportTz: envVars.DEFAULT_REPORT_TZ,
    mailEnabled: envVars.MAIL_ENABLED,
    mailFrom: envVars.MAIL_FROM,
    mailProvider: envVars.MAIL_PROVIDER,
    ...(envVars.RESEND_API_KEY ? { resendApiKey: envVars.RESEND_API_KEY } : {}),
    smtpHost: envVars.SMTP_HOST,
    smtpPort,
    smtpSecure,
    ...(smtpUser ? { smtpUser } : {}),
    ...(smtpPass ? { smtpPass } : {}),
  };
}
