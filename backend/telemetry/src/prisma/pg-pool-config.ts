import type { PoolConfig } from 'pg';

export const DB_SSL_CA_PATTERN = /-----BEGIN CERTIFICATE-----/;

export interface PgPoolOptions {
  // Maximum connections of this pool. Unset keeps the pg default (10).
  max?: number;
  // Encrypt the connection. Unset or false keeps the plain connection that
  // local dev, compose and CI use.
  ssl?: boolean;
  // PEM of the CA that signed the server certificate (`DB_SSL_CA`).
  sslCa?: string;
}

// `DB_SSL_CA` is the PEM content. Platforms that cannot hold multi-line values
// may send literal `\n` sequences: turn them into newlines. Blank is unset.
export function normalizePem(raw?: string): string | undefined {
  const pem = raw?.replace(/\\n/g, '\n').trim();
  return pem ? pem : undefined;
}

// Pool config for `PrismaPg` (its first argument). With no options the result
// is just `{ connectionString }`, i.e. the current behavior.
//
// SSL tradeoff: with `ssl` and no CA the traffic is encrypted but the server
// certificate is NOT verified (`rejectUnauthorized: false`), so a
// man-in-the-middle is not detected. Supabase signs with its own CA: set
// `sslCa` to its PEM to get full verification.
//
// pg gives the connection string precedence over this config, so a
// `sslmode=` in the URL overrides `ssl`. Prefer `DB_SSL` over `sslmode`.
export function buildPgPoolConfig(
  connectionString: string,
  options: PgPoolOptions = {},
): PoolConfig {
  const config: PoolConfig = { connectionString };
  if (options.max !== undefined) config.max = options.max;
  if (options.ssl) {
    const ca = normalizePem(options.sslCa);
    config.ssl = ca ? { ca } : { rejectUnauthorized: false };
  }
  return config;
}
