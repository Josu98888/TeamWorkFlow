import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hashToken } from './crypto';
import { envs } from '../config';
import { PrismaService } from './prisma/prisma.service';
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
const USER_ID = '0199b7e0-0000-7000-8000-000000000001';
const TENANT_ID = '0199b7e0-0000-7000-8000-000000000002';

// Covers: S3.2
describe('TokenService', () => {
  let service: TokenService;
  let jwt: JwtService;
  const create = jest.fn();
  const prisma = { refreshToken: { create } };

  beforeEach(async () => {
    // Fake only Date: jsonwebtoken signs through timers/ticks.
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
    create.mockReset().mockResolvedValue({});
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: envs.jwtSecret,
          signOptions: { algorithm: 'HS256' },
        }),
      ],
      providers: [TokenService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(TokenService);
    jwt = moduleRef.get(JwtService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('issueTokenPair', () => {
    it('signs an HS256 access token with exactly the allowed claims', async () => {
      const pair = await service.issueTokenPair({
        id: USER_ID,
        tenantId: TENANT_ID,
        role: 'OWNER',
      });

      const claims = jwt.decode<Record<string, unknown>>(pair.accessToken);
      expect(Object.keys(claims).sort()).toEqual(
        ['sub', 'tenantId', 'role', 'jti', 'iat', 'exp'].sort(),
      );
      expect(claims.sub).toBe(USER_ID);
      expect(claims.tenantId).toBe(TENANT_ID);
      expect(claims.role).toBe('owner');
      expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
      expect((claims.exp as number) - (claims.iat as number)).toBe(15 * 60);
      const header = JSON.parse(
        Buffer.from(pair.accessToken.split('.')[0], 'base64url').toString(),
      ) as { alg: string };
      expect(header.alg).toBe('HS256');
    });

    it('verifies with the configured secret', async () => {
      const pair = await service.issueTokenPair({
        id: USER_ID,
        tenantId: TENANT_ID,
        role: 'ADMIN',
      });

      await expect(
        jwt.verifyAsync(pair.accessToken, { secret: envs.jwtSecret }),
      ).resolves.toMatchObject({ sub: USER_ID });
    });

    it('issues a null tenantId for platform_admin', async () => {
      const pair = await service.issueTokenPair({
        id: USER_ID,
        tenantId: null,
        role: 'PLATFORM_ADMIN',
      });

      const claims = jwt.decode<Record<string, unknown>>(pair.accessToken);
      expect(claims.tenantId).toBeNull();
      expect(claims.role).toBe('platform_admin');
    });

    it('uses a different jti on every call', async () => {
      const user = { id: USER_ID, tenantId: TENANT_ID, role: 'OWNER' as const };
      const a = await service.issueTokenPair(user);
      const b = await service.issueTokenPair(user);

      expect(jwt.decode<{ jti: string }>(a.accessToken).jti).not.toBe(
        jwt.decode<{ jti: string }>(b.accessToken).jti,
      );
    });

    it('stores only the hash of the refresh token', async () => {
      const pair = await service.issueTokenPair({
        id: USER_ID,
        tenantId: TENANT_ID,
        role: 'OWNER',
      });

      expect(create).toHaveBeenCalledTimes(1);
      const { data } = create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.userId).toBe(USER_ID);
      expect(data.tokenHash).toBe(hashToken(pair.refreshToken));
      expect(JSON.stringify(data)).not.toContain(pair.refreshToken);
      expect(data.expiresAt).toEqual(
        new Date(NOW.getTime() + 7 * 24 * 3600 * 1000),
      );
    });

    it('returns the pair with expiresIn in seconds', async () => {
      const pair = await service.issueTokenPair({
        id: USER_ID,
        tenantId: TENANT_ID,
        role: 'OWNER',
      });

      expect(Object.keys(pair).sort()).toEqual([
        'accessToken',
        'expiresIn',
        'refreshToken',
      ]);
      expect(pair.expiresIn).toBe(900);
      expect(pair.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('writes through the given transaction client instead of prisma', async () => {
      const txCreate = jest.fn().mockResolvedValue({});

      await service.issueTokenPair(
        { id: USER_ID, tenantId: TENANT_ID, role: 'OWNER' },
        // Only `refreshToken.create` is used; the full delegate is not needed.
        {
          refreshToken: { create: txCreate },
        } as unknown as Parameters<TokenService['issueTokenPair']>[1],
      );

      expect(txCreate).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
    });
  });
});
