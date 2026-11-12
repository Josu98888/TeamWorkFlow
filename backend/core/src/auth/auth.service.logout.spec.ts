import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hashToken } from './crypto';
import { InvalidTokenException } from '../common/exceptions/app.exceptions';
import { envs } from '../config';
import { JetStreamService } from './events/jetstream.service';
import { PrismaService } from './prisma/prisma.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// Only the class shape of the generated client is needed; this avoids building a driver adapter.
jest.mock('./prisma/generated/client', () => ({ PrismaClient: class {} }));

const NOW = new Date('2026-10-12T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const RAW = 'raw-refresh-token';

interface Row {
  id: string;
  tokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
  user: {
    id: string;
    tenantId: string;
    role: 'OWNER';
    isActive: boolean;
    tenant: { status: 'ACTIVE' };
  };
}

interface Where {
  id?: string;
  tokenHash?: string;
  revokedAt?: null;
}

// Covers: S3.6
describe('AuthService.logout', () => {
  let service: AuthService;
  let rows: Row[];
  const updateMany = jest.fn();

  // Minimal in-memory refresh_tokens table shared by logout and refresh.
  const refreshToken = {
    findUnique: ({ where }: { where: { tokenHash: string } }) =>
      Promise.resolve(
        rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
      ),
    updateMany: (args: { where: Where; data: { revokedAt: Date } }) => {
      updateMany(args);
      const matches = rows.filter(
        (r) =>
          (args.where.id === undefined || r.id === args.where.id) &&
          (args.where.tokenHash === undefined ||
            r.tokenHash === args.where.tokenHash) &&
          (args.where.revokedAt === undefined || r.revokedAt === null),
      );
      matches.forEach((r) => (r.revokedAt = args.data.revokedAt));
      return Promise.resolve({ count: matches.length });
    },
    create: ({ data }: { data: { tokenHash: string } }) => {
      rows.push(row({ id: `new-${rows.length}`, tokenHash: data.tokenHash }));
      return Promise.resolve({});
    },
  };
  const prisma = {
    refreshToken,
    $transaction: (
      fn: (tx: { refreshToken: typeof refreshToken }) => unknown,
    ) => fn({ refreshToken }),
  };

  function row(overrides: Partial<Row> = {}): Row {
    return {
      id: 'token-1',
      tokenHash: hashToken(RAW),
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + DAY),
      user: {
        id: 'user-1',
        tenantId: 'tenant-1',
        role: 'OWNER',
        isActive: true,
        tenant: { status: 'ACTIVE' },
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    // Fake only Date: jsonwebtoken needs real timers/ticks.
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    updateMany.mockClear();
    rows = [row()];

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: envs.jwtSecret,
          signOptions: { algorithm: 'HS256' },
        }),
      ],
      providers: [
        AuthService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: JetStreamService, useValue: { publish: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('revokes the token by its hash and returns { ok: true }', async () => {
    await expect(service.logout({ refreshToken: RAW })).resolves.toEqual({
      ok: true,
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(RAW), revokedAt: null },
      data: { revokedAt: NOW },
    });
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain(RAW);
    expect(rows[0].revokedAt).toEqual(NOW);
  });

  it('a refresh with that token afterwards returns invalid_token', async () => {
    await service.logout({ refreshToken: RAW });

    const error = await service.refresh({ refreshToken: RAW }).then(
      () => {
        throw new Error('Expected refresh to fail');
      },
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(InvalidTokenException);
    expect((error as InvalidTokenException).getError()).toEqual(
      expect.objectContaining({ status: 401, code: 'invalid_token' }),
    );
    // Nothing was rotated.
    expect(rows).toHaveLength(1);
  });

  it('only revokes the given token, not other tokens of the same user', async () => {
    rows.push(row({ id: 'token-2', tokenHash: hashToken('other-token') }));

    await service.logout({ refreshToken: RAW });

    expect(rows[1].revokedAt).toBeNull();
  });

  it('is idempotent for an unknown token', async () => {
    await expect(service.logout({ refreshToken: 'nope' })).resolves.toEqual({
      ok: true,
    });
    expect(rows[0].revokedAt).toBeNull();
  });

  it('is idempotent for an already revoked token and keeps its original revokedAt', async () => {
    const earlier = new Date(NOW.getTime() - DAY);
    rows = [row({ revokedAt: earlier })];

    await expect(service.logout({ refreshToken: RAW })).resolves.toEqual({
      ok: true,
    });
    await expect(service.logout({ refreshToken: RAW })).resolves.toEqual({
      ok: true,
    });

    expect(rows[0].revokedAt).toEqual(earlier);
  });

  it('revokes an expired token too and answers { ok: true }', async () => {
    rows = [row({ expiresAt: new Date(NOW.getTime() - 1000) })];

    await expect(service.logout({ refreshToken: RAW })).resolves.toEqual({
      ok: true,
    });
    expect(rows[0].revokedAt).toEqual(NOW);
  });
});
