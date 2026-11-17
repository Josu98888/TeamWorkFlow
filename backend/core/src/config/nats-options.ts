import { credsAuthenticator } from '@nats-io/transport-node';
import type { Authenticator } from '@nats-io/transport-node';

export const NATS_CREDS_MARKER = '-----BEGIN NATS USER JWT-----';
export const NATS_CREDS_PATTERN = /-----BEGIN NATS USER JWT-----/;

export interface NatsConnectOptions {
  servers: string[];
  authenticator?: Authenticator;
}

// `NATS_CREDS` is the full content of a `.creds` file. Platforms that cannot
// hold multi-line values may send literal `\n` sequences: turn them into
// newlines. Blank values count as unset.
export function normalizeNatsCreds(raw?: string): string | undefined {
  const creds = raw?.replace(/\n/g, '\n').trim();
  return creds ? creds : undefined;
}

// Connect options shared by every NATS connection. Without credentials the
// result is just `{ servers }` (local dev, CI, compose). Never log `creds`.
export function buildNatsOptions(
  servers: string[],
  creds?: string,
): NatsConnectOptions {
  const normalized = normalizeNatsCreds(creds);
  return normalized
    ? {
        servers,
        authenticator: credsAuthenticator(new TextEncoder().encode(normalized)),
      }
    : { servers };
}
