import {
  buildNatsOptions,
  normalizeNatsCreds,
  NATS_CREDS_MARKER,
} from './nats-options';

const SERVERS = ['nats://localhost:4222'];
const CREDS = [
  '-----BEGIN NATS USER JWT-----',
  'eyJ0eXAiOiJKV1QifQ.e30.sig',
  '------END NATS USER JWT------',
  '',
  '-----BEGIN USER NKEY SEED-----',
  'SUAIBDPBAUTWCWBKIO6XHQNINK5FWJW4OHLXC3HQ2KFE4PEJUA44CNHTC4',
  '------END USER NKEY SEED------',
].join('\n');

describe('nats-options', () => {
  it('returns only the servers when credentials are unset or blank', () => {
    expect(buildNatsOptions(SERVERS)).toEqual({ servers: SERVERS });
    expect(buildNatsOptions(SERVERS, '  ')).toEqual({ servers: SERVERS });
  });

  it('adds an authenticator when credentials are set', () => {
    const options = buildNatsOptions(SERVERS, CREDS);
    expect(options.servers).toBe(SERVERS);
    expect(typeof options.authenticator).toBe('function');
  });

  it('converts literal \n sequences to newlines', () => {
    expect(normalizeNatsCreds(CREDS.replace(/\n/g, '\n'))).toBe(CREDS);
    expect(normalizeNatsCreds(CREDS)).toContain(NATS_CREDS_MARKER);
  });

  it('normalizes unset and blank values to undefined', () => {
    expect(normalizeNatsCreds(undefined)).toBeUndefined();
    expect(normalizeNatsCreds('')).toBeUndefined();
  });
});
