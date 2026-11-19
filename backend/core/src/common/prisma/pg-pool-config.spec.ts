import {
  buildPgPoolConfig,
  normalizePem,
  pgPoolOptionsFromEnv,
} from './pg-pool-config';

const URL = 'postgresql://auth_svc:secret@localhost:5432/teamworkflow';
const PEM = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----';

describe('buildPgPoolConfig', () => {
  it('returns only the connection string by default (current behavior)', () => {
    expect(buildPgPoolConfig(URL)).toEqual({ connectionString: URL });
    expect(buildPgPoolConfig(URL, { ssl: false, sslCa: PEM })).toEqual({
      connectionString: URL,
    });
  });

  it('sets the pool size', () => {
    expect(buildPgPoolConfig(URL, { max: 3 })).toEqual({
      connectionString: URL,
      max: 3,
    });
  });

  it('encrypts without verifying the certificate when there is no CA', () => {
    expect(buildPgPoolConfig(URL, { ssl: true })).toEqual({
      connectionString: URL,
      ssl: { rejectUnauthorized: false },
    });
  });

  it('verifies the server certificate against the CA when given', () => {
    expect(buildPgPoolConfig(URL, { ssl: true, sslCa: PEM })).toEqual({
      connectionString: URL,
      ssl: { ca: PEM },
    });
    expect(
      buildPgPoolConfig(URL, { ssl: true, sslCa: PEM.replace(/\n/g, '\\n') }),
    ).toEqual({ connectionString: URL, ssl: { ca: PEM } });
  });
});

describe('normalizePem', () => {
  it('treats blank as unset', () => {
    expect(normalizePem(undefined)).toBeUndefined();
    expect(normalizePem('  ')).toBeUndefined();
  });
});

describe('pgPoolOptionsFromEnv', () => {
  it('defaults to no options', () => {
    expect(pgPoolOptionsFromEnv({})).toEqual({
      max: undefined,
      ssl: false,
      sslCa: undefined,
    });
  });

  it('reads DB_POOL_MAX, DB_SSL and DB_SSL_CA', () => {
    expect(
      pgPoolOptionsFromEnv({
        DB_POOL_MAX: '3',
        DB_SSL: 'TRUE',
        DB_SSL_CA: PEM,
      }),
    ).toEqual({ max: 3, ssl: true, sslCa: PEM });
    expect(pgPoolOptionsFromEnv({ DB_POOL_MAX: 'x' }).max).toBeUndefined();
  });
});
